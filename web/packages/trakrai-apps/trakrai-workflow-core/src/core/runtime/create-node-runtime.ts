import {
  EMPTY_OBJECT_SCHEMA,
  toEventSchemaLike,
  toObjectSchema,
  toResolvedEvents,
} from './schema-utils';
import { BasicInputOutputNodeHandler } from './workflow-node-handler';

import type {
  CreateNodeRuntimeArgs,
  NodeRuntime,
  NodeSchemaLike,
  NodeSchemaResolutionContext,
  ResolvedNodeSchema,
  ResolvedNodeSchemaSource,
} from './types';
import type { NodeSchema } from '../../types';

/**
 * Converts a static `NodeSchema` into a `ResolvedNodeSchemaSource` without
 * running handler resolution (used as a fallback for circular dependencies).
 */
const getStaticSchemaSource = (
  nodeSchema: NodeSchema | undefined,
): ResolvedNodeSchemaSource | undefined => {
  if (nodeSchema === undefined) {
    return undefined;
  }
  return {
    input: nodeSchema.input,
    output: nodeSchema.output,
    events: toEventSchemaLike(nodeSchema.events),
    configurationFields: nodeSchema.configurationFields,
    category: nodeSchema.category,
    description: nodeSchema.description,
  };
};

/**
 * Creates a {@link NodeRuntime} for the given graph.
 *
 * Registered `nodeHandlers` take precedence over static schemas. When no custom
 * handler exists for a known node type, the runtime synthesizes a
 * `BasicInputOutputNodeHandler` from the static `NodeSchema` plus any matching
 * `nodeFunctions` entry.
 *
 * Resolved schema sources and fully normalized schemas are cached by node ID.
 * Circular schema resolution is guarded by falling back to the static
 * `NodeSchema` for the node currently being resolved.
 */
export const createNodeRuntime = <Context extends object>({
  nodes,
  edges,
  nodeSchemas,
  nodeFunctions,
  nodeHandlers,
}: CreateNodeRuntimeArgs<Context>): NodeRuntime<Context> => {
  const nodeById = new Map<string, (typeof nodes)[number]>(nodes.map((node) => [node.id, node]));
  const handlerCache = new Map<string, ReturnType<NodeRuntime<Context>['getNodeHandler']>>();
  const schemaSourceCache = new Map<string, ResolvedNodeSchemaSource | undefined>();
  const schemaCache = new Map<string, ResolvedNodeSchema | undefined>();
  const resolving = new Set<string>();

  const getNodeHandler = (
    nodeType: string | undefined,
  ): ReturnType<NodeRuntime<Context>['getNodeHandler']> => {
    if (nodeType === undefined) {
      return undefined;
    }
    if (handlerCache.has(nodeType)) {
      return handlerCache.get(nodeType);
    }
    const customHandler = nodeHandlers?.[nodeType];
    if (customHandler !== undefined) {
      handlerCache.set(nodeType, customHandler);
      return customHandler;
    }
    const staticSchema = nodeSchemas[nodeType];
    if (staticSchema === undefined) {
      handlerCache.set(nodeType, undefined);
      return undefined;
    }
    const staticNodeFunction = nodeFunctions?.[nodeType];
    const defaultHandler = new BasicInputOutputNodeHandler(staticSchema, staticNodeFunction);
    handlerCache.set(nodeType, defaultHandler);
    return defaultHandler;
  };

  const resolveNodeSchemaById = (nodeId: string): ResolvedNodeSchema | undefined => {
    const node = nodeById.get(nodeId);
    if (node === undefined) {
      return undefined;
    }
    return resolveNodeSchema(node);
  };

  const resolveNodeSchemaSourceById = (nodeId: string): ResolvedNodeSchemaSource | undefined => {
    const node = nodeById.get(nodeId);
    if (node === undefined) {
      return undefined;
    }
    return resolveNodeSchemaSource(node);
  };

  const resolveNodeSchemaSource = (
    node: (typeof nodes)[number],
  ): ResolvedNodeSchemaSource | undefined => {
    if (schemaSourceCache.has(node.id)) {
      return schemaSourceCache.get(node.id);
    }
    const nodeType = node.type;
    if (nodeType === undefined) {
      schemaSourceCache.set(node.id, undefined);
      return undefined;
    }

    if (resolving.has(node.id)) {
      const staticFallback = getStaticSchemaSource(nodeSchemas[nodeType]);
      schemaSourceCache.set(node.id, staticFallback);
      return staticFallback;
    }

    const handler = getNodeHandler(nodeType);
    const staticNodeSchema = nodeSchemas[nodeType];
    if (handler === undefined && staticNodeSchema === undefined) {
      schemaSourceCache.set(node.id, undefined);
      return undefined;
    }

    resolving.add(node.id);
    try {
      const context: NodeSchemaResolutionContext = {
        node,
        nodes,
        edges,
        nodeSchemas,
        resolveNodeSchema: resolveNodeSchemaById,
        resolveNodeSchemaSource: resolveNodeSchemaSourceById,
      };

      const fallback = getStaticSchemaSource(staticNodeSchema);
      const resolved: ResolvedNodeSchemaSource = {
        input: (handler?.getInputSchema(context) ??
          fallback?.input ??
          EMPTY_OBJECT_SCHEMA) as NodeSchemaLike,
        output: (handler?.getOutputSchema(context) ??
          fallback?.output ??
          EMPTY_OBJECT_SCHEMA) as NodeSchemaLike,
        events: handler?.getEvents(context) ?? fallback?.events,
        configurationFields:
          handler?.getConfigurationFields(context) ?? fallback?.configurationFields,
        category: handler?.getCategory(context) ?? fallback?.category ?? 'custom',
        description: handler?.getDescription(context) ?? fallback?.description ?? '',
      };

      schemaSourceCache.set(node.id, resolved);
      return resolved;
    } finally {
      resolving.delete(node.id);
    }
  };

  const resolveNodeSchema = (node: (typeof nodes)[number]): ResolvedNodeSchema | undefined => {
    if (schemaCache.has(node.id)) {
      return schemaCache.get(node.id);
    }

    const source = resolveNodeSchemaSource(node);
    if (source === undefined) {
      schemaCache.set(node.id, undefined);
      return undefined;
    }

    const resolved: ResolvedNodeSchema = {
      input: toObjectSchema(source.input),
      output: toObjectSchema(source.output),
      events: toResolvedEvents(source.events),
      configurationFields: source.configurationFields,
      category: source.category,
      description: source.description,
    };

    schemaCache.set(node.id, resolved);
    return resolved;
  };

  return {
    getNodeHandler,
    resolveNodeSchema,
    resolveNodeSchemaById,
    resolveNodeSchemaSource,
    resolveNodeSchemaSourceById,
  };
};
