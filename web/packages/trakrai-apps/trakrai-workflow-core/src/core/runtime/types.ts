import type { WorkflowNodeHandler } from './workflow-node-handler';
import type {
  Edge,
  JsonObject,
  Node,
  NodeConfigurationField,
  NodeSchemas,
  PluginClientConfig,
  WorkflowData,
  WorkflowLogger,
} from '../../types';
import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@trpc/server';
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { z } from 'zod';

/** A JSON Schema value (Zod's internal representation, which may be a boolean or object). */
export type JSONSchemaLike = z.core.JSONSchema._JSONSchema;
/** A non-boolean JSON Schema object. */
export type JSONSchemaObject = z.core.JSONSchema.JSONSchema;
/** Generic key-value record returned by node execution. */
export type NodeOutput = Record<string, unknown>;
/** A value that may be synchronous or a Promise. */
export type MaybePromise<T> = Promise<T> | T;
/** Controls whether a node waits for `'all'` or `'any'` of its upstream dependencies. */
export type DependencyMode = 'all' | 'any';

/**
 * The execution function signature for a node at runtime.
 *
 * Unlike the strongly-typed `NodeFunction`, this operates on raw `Record<string, unknown>`
 * input/output and is used internally by the runtime engine.
 */
export type RuntimeNodeFunction<Context extends object> = (
  input: Record<string, unknown>,
  context: Context,
  events: Record<string, string>,
  logger: WorkflowLogger,
  node: Node,
) => MaybePromise<NodeOutput>;

/** A schema that can be either a Zod type or a plain JSON Schema object. */
export type NodeSchemaLike = z.ZodTypeAny | JSONSchemaLike;

/** An event schema in its unresolved form (data may be a Zod type or JSON Schema). */
export type NodeEventSchemaLike = {
  description: string;
  data: NodeSchemaLike;
};

/** A fully resolved JSON Schema object with `type: 'object'` and normalized properties/required fields. */
export type ResolvedObjectSchema = JSONSchemaObject & {
  type: 'object';
  properties: Record<string, JSONSchemaLike>;
  required?: string[];
};

/** A fully resolved event schema with its data converted to a `ResolvedObjectSchema`. */
export type ResolvedNodeEventSchema = {
  description: string;
  data: ResolvedObjectSchema;
};

/** A fully resolved node schema with JSON Schema objects for input/output and resolved events. */
export type ResolvedNodeSchema = {
  /** Resolved input schema with normalized properties. */
  input: ResolvedObjectSchema;
  /** Resolved output schema with normalized properties. */
  output: ResolvedObjectSchema;
  /** Resolved event schemas, if the node defines events. */
  events?: Record<string, ResolvedNodeEventSchema>;
  /** Handler-defined configuration fields. */
  configurationFields?: NodeConfigurationField[];
  /** The node type's category. */
  category: string;
  /** The node type's description. */
  description: string;
};

/**
 * Pre-resolution schema source returned by `NodeRuntime.resolveNodeSchemaSource`.
 *
 * Fields may still be Zod schemas instead of JSON Schema and can come from a
 * static `NodeSchema` fallback when circular resolution is detected.
 */
export type ResolvedNodeSchemaSource = {
  input: NodeSchemaLike;
  output: NodeSchemaLike;
  events?: Record<string, NodeEventSchemaLike>;
  configurationFields?: NodeConfigurationField[];
  category: string;
  description: string;
};

/** Context passed to `WorkflowNodeHandler` schema resolution methods, providing access to the full graph. */
export type NodeSchemaResolutionContext = {
  /** The node whose schema is being resolved. */
  node: Node;
  /** All nodes in the current graph. */
  nodes: Node[];
  /** All edges in the current graph. */
  edges: Edge[];
  /** Static node schema registry. */
  nodeSchemas: NodeSchemas;
  /** Resolves another node's fully resolved schema with the same cycle-safe caching used by the runtime. */
  resolveNodeSchema: (nodeId: string) => ResolvedNodeSchema | undefined;
  /** Resolves another node's pre-resolution schema source, including static fallbacks for cycles. */
  resolveNodeSchemaSource: (nodeId: string) => ResolvedNodeSchemaSource | undefined;
};

/** Arguments passed to a node handler's `execute` method. */
export type NodeExecutionArgs<Context> = {
  /** The node being executed. */
  node: Node;
  /** The assembled input data (from edges + configuration). */
  input: Record<string, unknown>;
  /** Application-specific execution context. */
  context: Context;
  /** Logger for the execution. */
  logger: WorkflowLogger;
  /** Map of event names to emitter IDs that downstream nodes can target with event handles. */
  events: Record<string, string>;
};

/** Client-side TRPC proxy type used for making API calls. */
export type TRPCClient = TRPCOptionsProxy<
  AnyRouter,
  {
    keyPrefix: false;
  }
>;

/** Context provided to node mutation lifecycle callbacks (onNodeAdded/Removed/Updated). */
export type NodeMutationCallbackContext<ExtraContext extends JsonObject = JsonObject> = {
  /** The workflow data after the mutation. */
  currentWorkflowData: WorkflowData;
  /** The workflow data before the mutation. */
  previousWorkflowData: WorkflowData;
  /** Application-specific extra context. */
  extras: ExtraContext;
  /** Plugin client configuration. */
  pluginContext: PluginClientConfig;
  /** TanStack Query client for cache operations. */
  queryClient: QueryClient;
  /** TRPC client proxy for server calls. */
  trpc: TRPCClient;
};

/** Arguments for the `onNodeAdded` lifecycle callback. */
export type NodeAddedCallbackArgs<ExtraContext extends JsonObject = JsonObject> =
  NodeMutationCallbackContext<ExtraContext> & {
    /** The newly added node. */
    node: Node;
  };

/** Arguments for the `onNodeRemoved` lifecycle callback. */
export type NodeRemovedCallbackArgs<ExtraContext extends JsonObject = JsonObject> =
  NodeMutationCallbackContext<ExtraContext> & {
    /** The removed node. */
    node: Node;
  };

/** Arguments for the `onNodeUpdated` lifecycle callback. */
export type NodeUpdatedCallbackArgs<ExtraContext extends JsonObject = JsonObject> =
  NodeMutationCallbackContext<ExtraContext> & {
    /** The node after the update. */
    node: Node;
    /** The node state before the update. */
    previousNode: Node;
  };

/** Registry of `WorkflowNodeHandler` instances keyed by node type name. Custom handlers take precedence over static schemas. */
export type NodeHandlerRegistry<Context extends object> = Partial<
  Record<string, WorkflowNodeHandler<Context>>
>;

/** Registry of runtime node functions keyed by node type name, used when a node type falls back to `BasicInputOutputNodeHandler`. */
export type RuntimeNodeFunctionRegistry<Context extends object> = Partial<
  Record<string, RuntimeNodeFunction<Context>>
>;

/**
 * Runtime interface for resolving node handlers and schemas within a workflow graph.
 *
 * Created via {@link createNodeRuntime}. Provides cached, cycle-safe schema
 * resolution and synthesizes `BasicInputOutputNodeHandler` instances for static
 * node types that do not register custom handlers.
 */
export type NodeRuntime<Context extends object> = {
  /** Returns the `WorkflowNodeHandler` for the given node type, or `undefined`. */
  getNodeHandler: (nodeType: string | undefined) => WorkflowNodeHandler<Context> | undefined;
  /** Resolves a node's fully converted JSON Schema (input/output/events). */
  resolveNodeSchema: (node: Node) => ResolvedNodeSchema | undefined;
  /** Resolves a node's fully converted JSON Schema by node ID. */
  resolveNodeSchemaById: (nodeId: string) => ResolvedNodeSchema | undefined;
  /** Resolves a node's pre-conversion schema source (may contain Zod types). */
  resolveNodeSchemaSource: (node: Node) => ResolvedNodeSchemaSource | undefined;
  /** Resolves a node's pre-conversion schema source by node ID. */
  resolveNodeSchemaSourceById: (nodeId: string) => ResolvedNodeSchemaSource | undefined;
};

/** Arguments for {@link createNodeRuntime}. */
export type CreateNodeRuntimeArgs<Context extends object> = {
  /** All nodes in the workflow graph. */
  nodes: Node[];
  /** All edges in the workflow graph. */
  edges: Edge[];
  /** Static node schema registry. */
  nodeSchemas: NodeSchemas;
  /** Optional map of runtime node functions used when no custom handler is registered for a node type. */
  nodeFunctions?: RuntimeNodeFunctionRegistry<Context>;
  /** Optional map of custom node handlers that override static schema-only behaviour. */
  nodeHandlers?: NodeHandlerRegistry<Context>;
};

/** Discriminated union result from parsing a value against a schema. */
export type SchemaParseResult<T = unknown> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: string;
    };
