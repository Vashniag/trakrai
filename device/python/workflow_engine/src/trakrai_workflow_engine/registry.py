from __future__ import annotations

import logging
from typing import Any

from .exceptions import NodeNotFoundError
from .models import NodeCategory, NodeDefinition, PortDefinition
from .types import NodeFunction

logger = logging.getLogger("trakrai_workflow_engine.registry")


class _NodeEntry:
    __slots__ = ("definition", "function")

    def __init__(self, definition: NodeDefinition, function: NodeFunction) -> None:
        self.definition = definition
        self.function = function


class NodeRegistry:
    def __init__(self) -> None:
        self._nodes: dict[str, _NodeEntry] = {}

    def register(
        self,
        node_type_id: str,
        function: NodeFunction,
        *,
        display_name: str = "",
        category: NodeCategory = NodeCategory.UTILITY,
        inputs: list[PortDefinition] | None = None,
        outputs: list[PortDefinition] | None = None,
        description: str = "",
        version: str = "1.0.0",
    ) -> None:
        definition = NodeDefinition(
            node_type_id=node_type_id,
            display_name=display_name or node_type_id,
            category=category,
            inputs=list(inputs or []),
            outputs=list(outputs or []),
            description=description,
            version=version,
        )
        self._nodes[node_type_id] = _NodeEntry(definition, function)
        logger.debug("Registered node type %s", node_type_id)

    def has(self, node_type_id: str) -> bool:
        return node_type_id in self._nodes

    def get_function(self, node_type_id: str) -> NodeFunction:
        entry = self._nodes.get(node_type_id)
        if entry is None:
            raise NodeNotFoundError(node_type_id)
        return entry.function

    def get_definition(self, node_type_id: str) -> NodeDefinition:
        entry = self._nodes.get(node_type_id)
        if entry is None:
            raise NodeNotFoundError(node_type_id)
        return entry.definition

    def clear(self) -> None:
        self._nodes.clear()

    def __len__(self) -> int:
        return len(self._nodes)


registry = NodeRegistry()


def register_node(
    node_type_id: str,
    *,
    display_name: str = "",
    category: NodeCategory = NodeCategory.UTILITY,
    inputs: list[PortDefinition] | None = None,
    outputs: list[PortDefinition] | None = None,
    description: str = "",
    version: str = "1.0.0",
) -> Any:
    def decorator(function: NodeFunction) -> NodeFunction:
        registry.register(
            node_type_id,
            function,
            display_name=display_name,
            category=category,
            inputs=inputs,
            outputs=outputs,
            description=description,
            version=version,
        )
        return function

    return decorator
