import { memo } from 'react';

import {
  createNodeRuntime,
  type NodeHandlerRegistry,
  type NodeSchema,
  type NodeSchemas,
} from '@trakrai-workflow/core';
import { createDisplayName } from '@trakrai-workflow/core/utils';

import InputOutputNode from './input-output-node';

import type { NodeTypes } from '@xyflow/react';

type FlowNodeComponent = NonNullable<NodeTypes[string]>;

const asFlowNodeComponent = <Props,>(component: React.ComponentType<Props>): FlowNodeComponent =>
  component as unknown as FlowNodeComponent;

const makeNodeComponent = (type: string, nodeSchema?: NodeSchema) => {
  const title = createDisplayName(type);

  const nodeComponent = memo(() => {
    return <InputOutputNode nodeSchema={nodeSchema} title={title} />;
  });
  nodeComponent.displayName = title;
  return asFlowNodeComponent(nodeComponent);
};

const getKnownNodeTypes = <Context extends object>(
  nodeSchemas: NodeSchemas,
  nodeHandlers?: NodeHandlerRegistry<Context>,
): string[] =>
  Array.from(new Set([...Object.keys(nodeSchemas), ...Object.keys(nodeHandlers ?? {})]));

/**
 * Creates a `NodeTypes` map for React Flow from registered node schemas and handlers.
 *
 * For each known node type, uses the handler's custom renderer if available,
 * otherwise falls back to the default `InputOutputNode`. Components are memoized.
 *
 * @typeParam Context - Application-specific context type.
 * @param nodeSchemas - Registry of node schemas.
 * @param nodeHandlers - Optional registry of node handlers with custom renderers.
 * @returns A `NodeTypes` object suitable for the React Flow `nodeTypes` prop.
 */
export const nodeTypes = <Context extends object>(
  nodeSchemas: NodeSchemas,
  nodeHandlers?: NodeHandlerRegistry<Context>,
  additionalNodeTypes: NodeTypes = {},
): NodeTypes => {
  const resolvedNodeTypes: NodeTypes = { ...additionalNodeTypes };

  for (const type of getKnownNodeTypes(nodeSchemas, nodeHandlers)) {
    const handlerRenderer = nodeHandlers?.[type]?.getRenderer;
    resolvedNodeTypes[type] =
      handlerRenderer !== undefined
        ? asFlowNodeComponent(handlerRenderer())
        : makeNodeComponent(type, nodeSchemas[type]);
  }

  return resolvedNodeTypes;
};

/* This is only used for rendering preview nodes in the sidebar for picking up new nodes */
/**
 * Returns a list of available node descriptors for display in the sidebar.
 *
 * Resolves each registered node type against a temporary runtime to extract
 * category, display name, and description metadata.
 *
 * @typeParam Context - Application-specific context type.
 * @param nodeSchemas - Registry of node schemas.
 * @param nodeHandlers - Optional registry of node handlers.
 * @returns An array of node descriptors with `type`, `displayName`, `category`, and `description`.
 */
export const nodes = <Context extends object>(
  nodeSchemas: NodeSchemas,
  nodeHandlers?: NodeHandlerRegistry<Context>,
) => {
  const typeList = getKnownNodeTypes(nodeSchemas, nodeHandlers);
  const previewNodes = typeList.map((type, index) => ({
    id: `__preview__${index}__${type}`,
    type,
    position: { x: 0, y: 0 },
    data: { configuration: null },
  }));
  const nodeRuntime = createNodeRuntime({
    nodes: previewNodes,
    edges: [],
    nodeSchemas,
    nodeHandlers,
  });
  return typeList.flatMap((type, index) => {
    const resolved = nodeRuntime.resolveNodeSchemaById(`__preview__${index}__${type}`);
    if (resolved === undefined) {
      return [];
    }
    return [
      {
        type,
        displayName: createDisplayName(type),
        category: resolved.category,
        description: resolved.description,
      },
    ];
  });
};
