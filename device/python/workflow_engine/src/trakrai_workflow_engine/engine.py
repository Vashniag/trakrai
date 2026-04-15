from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any

from .dag import DAG, DAGBuilder
from .models import ExecutionStatus, NodeResult, WorkflowDefinition, WorkflowNode
from .registry import NodeRegistry, registry as default_registry
from .types import WorkflowPayload
from .validator import WorkflowValidator

logger = logging.getLogger("trakrai_workflow_engine.engine")


@dataclass
class WorkflowExecutionResult:
    execution_id: str = ""
    success: bool = True
    duration_ms: float = 0.0
    node_results: dict[str, NodeResult] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    outputs: dict[str, Any] = field(default_factory=dict)


class WorkflowEngine:
    def __init__(self, registry: NodeRegistry | None = None, max_workers: int = 4, validate: bool = True) -> None:
        self._registry = registry or default_registry
        self._max_workers = max(1, int(max_workers))
        self._validate = validate
        self._dag: DAG | None = None
        self._workflow: WorkflowDefinition | None = None
        self._node_map: dict[str, WorkflowNode] = {}
        self._validator = WorkflowValidator(self._registry)
        self._dag_builder = DAGBuilder()

    @property
    def is_loaded(self) -> bool:
        return self._dag is not None and self._workflow is not None

    def load_workflow(self, workflow: dict[str, Any] | WorkflowDefinition) -> None:
        workflow_definition = (
            workflow if isinstance(workflow, WorkflowDefinition) else WorkflowDefinition.from_mapping(workflow)
        )
        if self._validate:
            workflow_definition = self._validator.validate_strict(workflow_definition)
        self._dag = self._dag_builder.build(workflow_definition)
        self._workflow = workflow_definition
        self._node_map = {node.id: node for node in workflow_definition.nodes}
        logger.info(
            "Workflow loaded with %d nodes, %d edges, %d levels",
            len(workflow_definition.nodes),
            len(workflow_definition.edges),
            len(self._dag.execution_levels),
        )

    def execute(self, detection_data: WorkflowPayload | dict[str, Any] | None = None) -> WorkflowExecutionResult:
        if not self.is_loaded:
            raise RuntimeError("No workflow loaded. Call load_workflow() first.")

        assert self._dag is not None
        execution_id = str(uuid.uuid4())[:8]
        started_at = time.monotonic()
        result_map: dict[str, NodeResult] = {}
        output_map: dict[tuple[str, str], Any] = {}
        failed_nodes: set[str] = set()
        context = {"detection_data": detection_data or {}}
        state_lock = threading.Lock()

        for level in self._dag.execution_levels:
            if len(level) == 1:
                self._execute_single_node(level[0], execution_id, context, output_map, result_map, failed_nodes, state_lock)
                continue

            with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
                futures = {
                    pool.submit(
                        self._execute_single_node,
                        node_id,
                        execution_id,
                        context,
                        output_map,
                        result_map,
                        failed_nodes,
                        state_lock,
                    ): node_id
                    for node_id in level
                }
                for future in as_completed(futures):
                    node_id = futures[future]
                    try:
                        future.result()
                    except Exception as exc:
                        logger.error("[%s] Unexpected error executing node %s: %s", execution_id, node_id, exc)

        duration_ms = (time.monotonic() - started_at) * 1000.0
        execution_result = WorkflowExecutionResult(
            execution_id=execution_id,
            success=len(failed_nodes) == 0,
            duration_ms=duration_ms,
            node_results=result_map,
            errors=[
                node_result.error
                for node_id, node_result in result_map.items()
                if node_id in failed_nodes and node_result.error
            ],
        )

        for leaf_id in self._dag.leaf_nodes:
            node_result = result_map.get(leaf_id)
            if node_result and node_result.status == ExecutionStatus.COMPLETED:
                execution_result.outputs[leaf_id] = node_result.outputs

        return execution_result

    def _execute_single_node(
        self,
        node_id: str,
        execution_id: str,
        context: dict[str, Any],
        output_map: dict[tuple[str, str], Any],
        result_map: dict[str, NodeResult],
        failed_nodes: set[str],
        state_lock: threading.Lock,
    ) -> None:
        assert self._dag is not None
        node = self._node_map[node_id]

        upstream_dependencies = self._dag.get_dependencies(node_id)
        if any(dependency in failed_nodes for dependency in upstream_dependencies):
            with state_lock:
                result_map[node_id] = NodeResult(
                    node_id=node_id,
                    status=ExecutionStatus.SKIPPED,
                    error="Skipped: upstream dependency failed.",
                )
                failed_nodes.add(node_id)
            return

        incoming_edges = self._dag.get_incoming_edges(node_id)
        for edge in incoming_edges:
            if not edge.is_conditional:
                continue
            source_output = output_map.get((edge.source_node_id, edge.source_handle))
            if edge.conditional_value is not None:
                if source_output != edge.conditional_value:
                    with state_lock:
                        result_map[node_id] = NodeResult(
                            node_id=node_id,
                            status=ExecutionStatus.SKIPPED,
                            error=(
                                f"Skipped: trigger from {edge.source_node_id}.{edge.source_handle} value "
                                f"{source_output!r} != expected {edge.conditional_value!r}."
                            ),
                        )
                    return
            elif not source_output:
                with state_lock:
                    result_map[node_id] = NodeResult(
                        node_id=node_id,
                        status=ExecutionStatus.SKIPPED,
                        error=f"Skipped: conditional edge from {edge.source_node_id}.{edge.source_handle} is falsy.",
                    )
                return

        inputs: dict[str, Any] = dict(node.data.configuration)
        inputs["__context__"] = context
        for edge in incoming_edges:
            if edge.target_handle == "trigger":
                continue
            value = output_map.get((edge.source_node_id, edge.source_handle))
            if value is not None:
                inputs[edge.target_handle] = value

        started_at = time.monotonic()
        try:
            function = self._registry.get_function(node.type)
            outputs = function(inputs)
            if not isinstance(outputs, dict):
                outputs = {"result": outputs}
            duration_ms = (time.monotonic() - started_at) * 1000.0
            with state_lock:
                for port_name, value in outputs.items():
                    output_map[(node_id, port_name)] = value
                result_map[node_id] = NodeResult(
                    node_id=node_id,
                    status=ExecutionStatus.COMPLETED,
                    outputs=outputs,
                    duration_ms=duration_ms,
                )
        except Exception as exc:
            duration_ms = (time.monotonic() - started_at) * 1000.0
            with state_lock:
                result_map[node_id] = NodeResult(
                    node_id=node_id,
                    status=ExecutionStatus.FAILED,
                    error=f"{type(exc).__name__}: {exc}",
                    duration_ms=duration_ms,
                )
                failed_nodes.add(node_id)
