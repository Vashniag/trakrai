import { type Node as XYNode, type Edge as XYEdge } from '@xyflow/react';

import type { z } from 'zod';

/** A JSON-compatible primitive value. */
export type JsonPrimitive = string | number | boolean | null;

/** A recursively JSON-compatible value (primitive, object, or array). */
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

/** A JSON-compatible key-value record. */
export type JsonObject = {
  [key: string]: JsonValue | undefined;
};

/**
 * Workflow graph node shape shared across Fluxery packages.
 *
 * The `data.configuration` object is the canonical store for per-node static
 * inputs that are later merged with upstream execution data by runtime helpers.
 */
export type Node = XYNode<{
  configuration?: Record<string, unknown> | null;
  [key: string]: unknown;
}>;

/**
 * Workflow graph edge shape shared across Fluxery packages.
 *
 * Fluxery uses handle IDs on edges to distinguish data flow, trigger flow, and
 * event-derived payload routing.
 */
export type Edge = XYEdge<{
  [key: string]: unknown;
}>;

/** Serializable snapshot of a workflow graph — the nodes and edges that make up the graph. */
export type WorkflowData = {
  nodes: Node[];
  edges: Edge[];
};

/** Describes a data dependency between two nodes via an edge. */
export type DependencyInfo = {
  /** The ID of the upstream node providing data. */
  sourceNodeId: string;
  /** The output handle on the source node. */
  sourceHandle: string;
  /** The input handle on the target node receiving data. */
  targetHandle: string;
  /** Optional conditional configuration for trigger edges. */
  conditional?: unknown;
};

/**
 * Discriminated union representing the stored result of executing a single node.
 *
 * Event emissions use the same shape but are keyed separately via
 * `buildNodeEventId(nodeId, eventName)`.
 */
export type ExecutionResult =
  | {
      id: string;
      success: true;
      data: unknown;
    }
  | {
      id: string;
      success: false;
      error: string;
    };

/** Summary of a workflow run including coarse lifecycle timestamps. */
export type WorkflowRun = {
  id: string;
  status: string;
  queuedAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
};

/**
 * Trace-oriented workflow run payload with nested per-node span data.
 *
 * Timestamp fields may already be deserialized `Date` instances or raw strings,
 * depending on which transport layer produced the payload.
 */
export type WorkflowRunData = {
  status?: string;
  trace?: {
    childrenSpans: Array<{
      name: string;
      status?: string | null;
      queuedAt?: Date | string | null;
      startedAt?: Date | string | null;
      endedAt?: Date | string | null;
      outputID?: string | null;
      attempts?: number | null;
      childrenSpans: Array<{
        outputID?: string | null;
        queuedAt?: Date | string | null;
      }>;
    }>;
  } | null;
};

/** Enum-like object of possible run statuses for a single node within a workflow execution. */
export const NodeRunStatus = {
  Waiting: 'waiting',
  Completed: 'completed',
  Failed: 'failed',
  Retrying: 'retrying',
  Failing: 'failing',
  Running: 'running',
} as const;
/** The string literal union of all possible node run statuses. */
export type NodeRunStatus = (typeof NodeRunStatus)[keyof typeof NodeRunStatus];

/**
 * Definition of a node event emitted as a side-channel output in addition to a
 * node's main `output` payload.
 */
export type NodeEvent = {
  description: string;
  data: z.ZodObject;
};

/** Describes a handler-defined configuration field rendered in the sidebar. */
export type NodeConfigurationField = {
  /** Unique key used to store the field value in the node's configuration. */
  key: string;
  /** Human-readable label displayed in the UI. */
  label: string;
  /** Optional description shown below the field label. */
  description?: string;
  /** Optional special field key referencing a `FluxerySpecialFieldConfig`. */
  field?: string;
  /** Optional additional configuration passed to the special field renderer. */
  fieldConfig?: Record<string, unknown>;
};

/**
 * Defines a node type's schema: its input/output Zod schemas, metadata, events, and configuration fields.
 *
 * @typeParam I - Zod schema type for inputs.
 * @typeParam O - Zod schema type for outputs.
 */
export type NodeSchema<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> = {
  /** Zod schema describing the node's input properties. */
  input: I;
  /** Zod schema describing the node's output properties. */
  output: O;
  /** Category used for grouping in the sidebar. */
  category: string;
  /** Human-readable description of the node type. */
  description: string;
  /** Optional map of event names to event definitions (side-channel outputs). */
  events?: Record<string, NodeEvent>;
  /** Optional handler-defined configuration fields rendered in the sidebar. */
  configurationFields?: NodeConfigurationField[];
};

/** Registry of node schemas keyed by node type name. */
export type NodeSchemas = Record<string, NodeSchema>;

/**
 * Maps event names to runtime emitter IDs exposed to a node function.
 *
 * Resolves to `Record<string, never>` when the node schema does not declare any events.
 */
export type NodeEventEmitters<E extends Record<string, NodeEvent> | undefined> =
  E extends Record<string, NodeEvent> ? { [EventName in keyof E]: string } : Record<string, never>;

/**
 * Logger interface passed to node functions during workflow execution.
 *
 * Only `info` is required. Other levels are optional so consumers can wire the
 * runtime to minimal or fully featured logging implementations.
 */
export interface WorkflowLogger {
  /** Logs routine execution information. */
  info: (...args: unknown[]) => void;
  /** Logs non-fatal warnings. */
  warn?: (...args: unknown[]) => void;
  /** Logs failures or unexpected runtime errors. */
  error?: (...args: unknown[]) => void;
  /** Logs verbose debugging details when available. */
  debug?: (...args: unknown[]) => void;
}

/**
 * The execution function for a single node type. Receives parsed input and returns typed output.
 *
 * @typeParam S - The full node schemas registry.
 * @typeParam K - The specific node type key.
 * @typeParam Context - Application-specific execution context.
 *
 * Inputs are parsed from the node schema before invocation. The returned value
 * is expected to match the node's output schema and may be used to feed
 * downstream node inputs.
 */
export type NodeFunction<S extends NodeSchemas, K extends keyof S, Context extends object> = (
  input: z.output<S[K]['input']>,
  context: Context,
  events: NodeEventEmitters<S[K]['events']>,
  logger: WorkflowLogger,
  node: Node,
) => z.output<S[K]['output']> | Promise<z.output<S[K]['output']>>;

/** A complete map of node type keys to their execution functions. */
export type NodeFunctions<S extends NodeSchemas, Context extends object> = {
  [K in keyof S]: NodeFunction<S, K, Context>;
};

/** Detailed execution metadata captured for a single node run, including retry/failure state. */
export type NodeRunDetails = {
  /** Current status of the node execution. */
  nodeStatus: NodeRunStatus;
  /** Error message if the node ultimately failed. */
  failureReason?: string | undefined;
  /** When the node execution was queued. */
  queuedAt?: Date | null;
  /** When the node began executing. */
  startedAt?: Date | null;
  /** When the node finished executing. */
  endedAt?: Date | null;
  /** Number of execution attempts (for retrying nodes). */
  attempts?: number | null;
  /** Error message from a retrying/failing state (before final failure). */
  failingErrorMessage?: string | null;
  /** Stack trace of the failing error. */
  failureErrorStack?: string | null;
  /** The node's output data if execution succeeded. */
  output?: unknown;
};

/** Reserved handle ID used for trigger edges that control execution order instead of carrying data. */
export const TriggerHandle = 'trigger';
/** Reserved handle ID for the boolean "execution success" output that routing helpers can target. */
export const ExecutionSuccessHandle = '__executionSuccess__';
/** Edge type identifier used by conditional routing UI/runtime integrations. */
export const ConditionalEdgeType = 'conditionalEdge';

/** Client-side base configuration for talking to plugin-backed API handlers. */
export type PluginClientConfig = {
  /** The TRPC endpoint path (e.g. `'/trpc'`). */
  endpoint: string;
  /** The base URL of the API server. */
  baseUrl: string;
};
