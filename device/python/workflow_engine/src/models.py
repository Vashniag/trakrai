from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any


class NodeCategory(str, enum.Enum):
    TRIGGER = "trigger"
    TRANSFORM = "transform"
    CONDITION = "condition"
    ACTION = "action"
    AGGREGATOR = "aggregator"
    DATA_SOURCE = "data-source"
    FILTER = "filter"
    UTILITY = "utility"


@dataclass(frozen=True)
class TypeSchema:
    type: str
    items: "TypeSchema | None" = None
    properties: dict[str, "TypeSchema"] | None = None
    required_fields: list[str] | None = None
    additional_properties: "TypeSchema | None" = None
    enum_values: list[Any] | None = None
    nullable: bool = False
    description: str = ""


def t_number(*, nullable: bool = False, description: str = "") -> TypeSchema:
    return TypeSchema(type="number", nullable=nullable, description=description)


def t_string(*, nullable: bool = False, description: str = "") -> TypeSchema:
    return TypeSchema(type="string", nullable=nullable, description=description)


def t_boolean(*, nullable: bool = False, description: str = "") -> TypeSchema:
    return TypeSchema(type="boolean", nullable=nullable, description=description)


def t_any(*, nullable: bool = False, description: str = "") -> TypeSchema:
    return TypeSchema(type="any", nullable=nullable, description=description)


def t_array(items: TypeSchema, *, nullable: bool = False, description: str = "") -> TypeSchema:
    return TypeSchema(type="array", items=items, nullable=nullable, description=description)


def t_object(
    properties: dict[str, TypeSchema],
    *,
    required: list[str] | None = None,
    nullable: bool = False,
    description: str = "",
) -> TypeSchema:
    return TypeSchema(
        type="object",
        properties=properties,
        required_fields=required,
        nullable=nullable,
        description=description,
    )


def t_record(value_type: TypeSchema, *, nullable: bool = False, description: str = "") -> TypeSchema:
    return TypeSchema(
        type="object",
        additional_properties=value_type,
        nullable=nullable,
        description=description,
    )


@dataclass(frozen=True)
class PortDefinition:
    name: str
    type_schema: TypeSchema = field(default_factory=t_any)
    required: bool = True
    description: str = ""
    default: Any = None
    port_type: str = "handle"
    special_field: str = ""

    @property
    def data_type(self) -> str:
        return self.type_schema.type


@dataclass(frozen=True)
class NodeDefinition:
    node_type_id: str
    display_name: str
    category: NodeCategory = NodeCategory.UTILITY
    inputs: list[PortDefinition] = field(default_factory=list)
    outputs: list[PortDefinition] = field(default_factory=list)
    description: str = ""
    version: str = "1.0.0"

    def get_input_port(self, port_name: str) -> PortDefinition | None:
        for port in self.inputs:
            if port.name == port_name:
                return port
        return None

    def get_output_port(self, port_name: str) -> PortDefinition | None:
        for port in self.outputs:
            if port.name == port_name:
                return port
        return None


class ExecutionStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class NodeResult:
    node_id: str
    status: ExecutionStatus
    outputs: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    duration_ms: float = 0.0


@dataclass(frozen=True)
class NodePosition:
    x: float = 0.0
    y: float = 0.0

    @classmethod
    def from_value(cls, value: Any) -> "NodePosition":
        if not isinstance(value, dict):
            return cls()
        return cls(
            x=float(value.get("x", 0.0) or 0.0),
            y=float(value.get("y", 0.0) or 0.0),
        )


@dataclass(frozen=True)
class NodeData:
    label: str = ""
    configuration: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_value(cls, value: Any) -> "NodeData":
        if not isinstance(value, dict):
            return cls()
        configuration = value.get("configuration", {})
        if not isinstance(configuration, dict):
            configuration = {}
        return cls(label=str(value.get("label", "")), configuration=dict(configuration))


@dataclass(frozen=True)
class WorkflowNode:
    id: str
    type: str
    position: NodePosition = field(default_factory=NodePosition)
    data: NodeData = field(default_factory=NodeData)

    @classmethod
    def from_mapping(cls, value: Any) -> "WorkflowNode":
        if not isinstance(value, dict):
            raise ValueError("workflow node must be an object")
        node_id = str(value.get("id", "")).strip()
        node_type = str(value.get("type", "")).strip()
        if not node_id:
            raise ValueError("workflow node id is required")
        if not node_type:
            raise ValueError(f"workflow node {node_id!r} type is required")
        return cls(
            id=node_id,
            type=node_type,
            position=NodePosition.from_value(value.get("position")),
            data=NodeData.from_value(value.get("data")),
        )


@dataclass(frozen=True)
class WorkflowEdge:
    id: str
    source: str
    sourceHandle: str
    target: str
    targetHandle: str
    type: str | None = None
    data: dict[str, Any] | None = None

    @classmethod
    def from_mapping(cls, value: Any) -> "WorkflowEdge":
        if not isinstance(value, dict):
            raise ValueError("workflow edge must be an object")
        edge_id = str(value.get("id", "")).strip()
        source = str(value.get("source", "")).strip()
        source_handle = str(value.get("sourceHandle", "")).strip()
        target = str(value.get("target", "")).strip()
        target_handle = str(value.get("targetHandle", "")).strip()
        if not edge_id:
            edge_id = f"{source}:{source_handle}->{target}:{target_handle}"
        if not source or not target or not source_handle or not target_handle:
            raise ValueError(f"workflow edge {edge_id!r} is missing required fields")
        data = value.get("data")
        if data is not None and not isinstance(data, dict):
            raise ValueError(f"workflow edge {edge_id!r} data must be an object")
        return cls(
            id=edge_id,
            source=source,
            sourceHandle=source_handle,
            target=target,
            targetHandle=target_handle,
            type=str(value.get("type", "")).strip() or None,
            data=dict(data) if isinstance(data, dict) else None,
        )


@dataclass(frozen=True)
class WorkflowDefinition:
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, value: Any) -> "WorkflowDefinition":
        if not isinstance(value, dict):
            raise ValueError("workflow must be an object")
        raw_nodes = value.get("nodes")
        raw_edges = value.get("edges")
        if not isinstance(raw_nodes, list):
            raise ValueError("workflow.nodes must be an array")
        if not isinstance(raw_edges, list):
            raise ValueError("workflow.edges must be an array")
        metadata = value.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}
        return cls(
            nodes=[WorkflowNode.from_mapping(item) for item in raw_nodes],
            edges=[WorkflowEdge.from_mapping(item) for item in raw_edges],
            metadata=dict(metadata),
        )

    def get_node(self, node_id: str) -> WorkflowNode | None:
        for node in self.nodes:
            if node.id == node_id:
                return node
        return None
