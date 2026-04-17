from __future__ import annotations

import logging
from typing import Any

from .exceptions import ValidationError
from .models import NodeDefinition, WorkflowDefinition, WorkflowEdge, WorkflowNode
from .registry import NodeRegistry, registry as default_registry

logger = logging.getLogger("workflow_engine.validator")

_TYPE_COMPAT: dict[str, set[str]] = {
    "any": {"any", "number", "string", "boolean", "array", "object"},
    "number": {"any", "number"},
    "string": {"any", "string"},
    "boolean": {"any", "boolean"},
    "array": {"any", "array"},
    "object": {"any", "object"},
}


def _types_compatible(source_type: str, target_type: str) -> bool:
    if source_type == "any" or target_type == "any":
        return True
    return target_type in _TYPE_COMPAT.get(source_type, {"any"})


class WorkflowValidator:
    class Result:
        def __init__(self) -> None:
            self.valid = True
            self.errors: list[str] = []
            self.warnings: list[str] = []

        def add_error(self, message: str) -> None:
            self.valid = False
            self.errors.append(message)

        def add_warning(self, message: str) -> None:
            self.warnings.append(message)

    def __init__(self, registry: NodeRegistry | None = None) -> None:
        self._registry = registry or default_registry

    def validate(self, workflow: dict[str, Any] | WorkflowDefinition) -> "WorkflowValidator.Result":
        result = self.Result()
        try:
            wf = workflow if isinstance(workflow, WorkflowDefinition) else WorkflowDefinition.from_mapping(workflow)
        except ValueError as exc:
            result.add_error(f"Invalid workflow JSON structure: {exc}")
            return result

        if not wf.nodes:
            result.add_error("Workflow has no nodes.")
            return result

        node_map: dict[str, WorkflowNode] = {node.id: node for node in wf.nodes}
        definition_map: dict[str, NodeDefinition] = {}

        for node in wf.nodes:
            if not self._registry.has(node.type):
                result.add_error(f"Node {node.id!r}: type {node.type!r} is not registered.")
            else:
                definition_map[node.id] = self._registry.get_definition(node.type)

        if not result.valid:
            return result

        connected_inputs: dict[str, set[str]] = {node.id: set() for node in wf.nodes}
        for edge in wf.edges:
            self._validate_edge(edge, node_map, definition_map, connected_inputs, result)

        for node in wf.nodes:
            definition = definition_map.get(node.id)
            if definition is None:
                continue
            for port in definition.inputs:
                if not port.required:
                    continue
                has_edge = port.name in connected_inputs[node.id]
                has_config = port.name in node.data.configuration
                has_default = port.default is not None
                if not (has_edge or has_config or has_default):
                    result.add_error(
                        f"Node {node.id!r} ({node.type}): required input {port.name!r} is missing."
                    )

        return result

    def validate_strict(self, workflow: dict[str, Any] | WorkflowDefinition) -> WorkflowDefinition:
        result = self.validate(workflow)
        if not result.valid:
            raise ValidationError(
                f"Workflow validation failed with {len(result.errors)} error(s).",
                details=result.errors,
            )
        return workflow if isinstance(workflow, WorkflowDefinition) else WorkflowDefinition.from_mapping(workflow)

    def _validate_edge(
        self,
        edge: WorkflowEdge,
        node_map: dict[str, WorkflowNode],
        definition_map: dict[str, NodeDefinition],
        connected_inputs: dict[str, set[str]],
        result: "WorkflowValidator.Result",
    ) -> None:
        if edge.source not in node_map:
            result.add_error(f"Edge {edge.id!r}: source node {edge.source!r} does not exist.")
            return
        if edge.target not in node_map:
            result.add_error(f"Edge {edge.id!r}: target node {edge.target!r} does not exist.")
            return

        source_definition = definition_map.get(edge.source)
        target_definition = definition_map.get(edge.target)
        if source_definition is None or target_definition is None:
            return

        source_port = source_definition.get_output_port(edge.sourceHandle)
        if source_port is None:
            result.add_error(
                f"Edge {edge.id!r}: source handle {edge.sourceHandle!r} is not a valid output of {source_definition.node_type_id!r}."
            )
            return

        target_port = target_definition.get_input_port(edge.targetHandle)
        if target_port is None:
            if edge.targetHandle == "trigger":
                connected_inputs[edge.target].add(edge.targetHandle)
                return
            result.add_error(
                f"Edge {edge.id!r}: target handle {edge.targetHandle!r} is not a valid input of {target_definition.node_type_id!r}."
            )
            return

        if not _types_compatible(source_port.data_type, target_port.data_type):
            result.add_warning(
                f"Edge {edge.id!r}: type mismatch {source_port.data_type!r} -> {target_port.data_type!r}."
            )

        connected_inputs[edge.target].add(edge.targetHandle)
