from __future__ import annotations


class WorkflowError(Exception):
    """Base exception for workflow engine failures."""


class NodeNotFoundError(WorkflowError):
    def __init__(self, node_type: str):
        super().__init__(f"Node type {node_type!r} is not registered")
        self.node_type = node_type


class ValidationError(WorkflowError):
    def __init__(self, message: str, details: list[str] | None = None):
        super().__init__(message)
        self.details = details or []


class ExecutionError(WorkflowError):
    def __init__(self, node_id: str, node_type: str, cause: Exception):
        super().__init__(f"Execution failed for node {node_id!r} (type={node_type}): {cause}")
        self.node_id = node_id
        self.node_type = node_type
        self.cause = cause


class CyclicDependencyError(WorkflowError):
    def __init__(self, involved_nodes: list[str] | None = None):
        nodes = involved_nodes or []
        suffix = f" involving nodes: {', '.join(nodes)}" if nodes else ""
        super().__init__("Workflow graph contains a cyclic dependency" + suffix)
        self.involved_nodes = nodes


class IPCError(WorkflowError):
    """Raised when IPC transport calls fail."""
