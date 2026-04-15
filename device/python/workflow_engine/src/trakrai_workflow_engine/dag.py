from __future__ import annotations

import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

from .exceptions import CyclicDependencyError
from .models import WorkflowDefinition

logger = logging.getLogger("trakrai_workflow_engine.dag")


@dataclass(frozen=True)
class EdgeMapping:
    source_node_id: str
    source_handle: str
    target_node_id: str
    target_handle: str
    is_conditional: bool = False
    conditional_value: Any = None


@dataclass
class DAG:
    node_ids: list[str] = field(default_factory=list)
    adjacency: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    reverse_adjacency: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    execution_order: list[str] = field(default_factory=list)
    edge_mappings: list[EdgeMapping] = field(default_factory=list)
    incoming_edges: dict[str, list[EdgeMapping]] = field(default_factory=lambda: defaultdict(list))
    outgoing_edges: dict[str, list[EdgeMapping]] = field(default_factory=lambda: defaultdict(list))
    root_nodes: list[str] = field(default_factory=list)
    leaf_nodes: list[str] = field(default_factory=list)
    execution_levels: list[list[str]] = field(default_factory=list)

    def get_dependencies(self, node_id: str) -> list[str]:
        return list(self.reverse_adjacency.get(node_id, []))

    def get_incoming_edges(self, node_id: str) -> list[EdgeMapping]:
        return self.incoming_edges.get(node_id, [])


class DAGBuilder:
    def build(self, workflow: WorkflowDefinition) -> DAG:
        dag = DAG(node_ids=[node.id for node in workflow.nodes])

        for edge in workflow.edges:
            is_trigger = edge.targetHandle == "trigger"
            conditional_value = None
            if is_trigger and isinstance(edge.data, dict):
                conditional_value = edge.data.get("configuration")
            mapping = EdgeMapping(
                source_node_id=edge.source,
                source_handle=edge.sourceHandle,
                target_node_id=edge.target,
                target_handle=edge.targetHandle,
                is_conditional=is_trigger or edge.type == "conditionalEdge",
                conditional_value=conditional_value,
            )
            dag.edge_mappings.append(mapping)
            dag.incoming_edges[edge.target].append(mapping)
            dag.outgoing_edges[edge.source].append(mapping)
            if edge.target not in dag.adjacency[edge.source]:
                dag.adjacency[edge.source].append(edge.target)
            if edge.source not in dag.reverse_adjacency[edge.target]:
                dag.reverse_adjacency[edge.target].append(edge.source)

        nodes_with_incoming = {edge.target for edge in workflow.edges}
        dag.root_nodes = [node_id for node_id in dag.node_ids if node_id not in nodes_with_incoming]

        nodes_with_outgoing = {edge.source for edge in workflow.edges}
        dag.leaf_nodes = [node_id for node_id in dag.node_ids if node_id not in nodes_with_outgoing]

        dag.execution_order, dag.execution_levels = self._topological_sort(dag)
        logger.info(
            "Built workflow DAG with %d nodes, %d edges, %d execution levels",
            len(dag.node_ids),
            len(dag.edge_mappings),
            len(dag.execution_levels),
        )
        return dag

    def _topological_sort(self, dag: DAG) -> tuple[list[str], list[list[str]]]:
        in_degree = {node_id: len(dag.reverse_adjacency.get(node_id, [])) for node_id in dag.node_ids}
        queue: deque[str] = deque(node_id for node_id in dag.node_ids if in_degree[node_id] == 0)
        ordered: list[str] = []
        levels: list[list[str]] = []

        while queue:
            current_level = list(queue)
            levels.append(current_level)
            queue.clear()

            for node_id in current_level:
                ordered.append(node_id)
                for downstream in dag.adjacency.get(node_id, []):
                    in_degree[downstream] -= 1
                    if in_degree[downstream] == 0:
                        queue.append(downstream)

        if len(ordered) != len(dag.node_ids):
            remaining = [node_id for node_id in dag.node_ids if node_id not in set(ordered)]
            raise CyclicDependencyError(remaining)

        return ordered, levels
