import type { QueryClient } from '@tanstack/react-query';
import type {
  JsonObject,
  Node,
  NodeConfigurationField,
  NodeHandlerRegistry,
  NodeRunDetails,
  NodeRunStatus,
  NodeRuntime,
  NodeSchemas,
  PluginClientConfig,
  WorkflowData,
} from '@trakrai-workflow/core';
import type { Connection, Edge, OnEdgesChange, OnNodesChange } from '@xyflow/react';
import type { JSONSchema } from 'zod/v4/core';

/** Color mode for the Fluxery editor theme. */
export type FluxeryTheme = 'light' | 'dark' | 'system';

/** A JSON-compatible value used in node configuration fields. */
export type FluxeryConfigValue =
  | string
  | number
  | boolean
  | null
  | FluxeryConfigValue[]
  | FluxeryConfigRecord;

/** A key-value record of configuration values, used for node `data.configuration`. */
export type FluxeryConfigRecord = {
  [key: string]: FluxeryConfigValue | undefined;
};

/** Context passed to special field renderers, providing access to the current node, schema, and configuration. */
export type FluxerySpecialFieldContext = {
  /** The configuration field definition from the node handler, if applicable. */
  field?: NodeConfigurationField;
  /** The current node configuration record. */
  configuration?: FluxeryConfigRecord;
  /** The node being configured. */
  node?: Node;
  /** The JSON schema for the field being rendered. */
  schema?: JSONSchema._JSONSchema;
  /** The active editor theme. */
  theme: FluxeryTheme;
};

/** Props received by special field renderer components. */
export type FluxerySpecialFieldRendererProps = {
  /** The current field value. */
  value: unknown;
  /** Callback to update the field value. */
  onChange: (value: unknown) => void;
  /** Optional context with node, schema, and configuration details. */
  context?: FluxerySpecialFieldContext;
};

/**
 * Configuration for a special field, either a select dropdown (`'options'`) or
 * a custom editor component (`'editor'`).
 */
export type FluxerySpecialFieldConfig =
  | {
      type: 'options';
      options:
        | Record<string, string>
        | ((context?: FluxerySpecialFieldContext) => Record<string, string>);
    }
  | {
      type: 'editor';
      component: React.ComponentType<FluxerySpecialFieldRendererProps>;
      display?: 'inline' | 'dialog';
      dialogSize?: 'default' | 'large' | 'fullscreen';
      dialogTitle?: string;
      dialogDescription?: string;
    };

/** Registry of special field configurations, keyed by field name. */
export type FluxerySpecialFields = Record<string, FluxerySpecialFieldConfig>;

/** Props forwarded to the React Flow canvas (nodes, edges, and change handlers). */
export type FluxeryFlowViewProps = {
  /** The current list of nodes in the workflow graph. */
  nodes: Node[];
  /** The current list of edges in the workflow graph. */
  edges: Edge[];
  /** Callback when nodes are moved, selected, or deleted. `undefined` in read-only mode. */
  onNodesChange?: OnNodesChange;
  /** Callback when edges are selected or deleted. `undefined` in read-only mode. */
  onEdgesChange?: OnEdgesChange;
  /** Callback when a new connection is made between handles. `undefined` in read-only mode. */
  onConnect?: (params: Connection) => void;
  /** Drag-over handler for node drag-and-drop from the sidebar. */
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  /** Drop handler for node drag-and-drop from the sidebar. */
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  /** Validates whether a proposed connection between two handles is allowed. */
  isValidConnection: (edge: Connection | Edge) => boolean;
};

/** Mutable workflow graph state exposed for advanced integrations. */
export type FluxeryWorkflowState = {
  edges: Edge[];
  nodes: Node[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
};

/** API for imperatively editing the workflow graph (adding nodes, connecting, and laying out). */
export type FluxeryEditingApi = {
  /** Adds a new node to the graph and returns the generated node ID. */
  addNode: (params: {
    type: string;
    position: { x: number; y: number };
    data: { configuration?: FluxeryConfigRecord | null };
  }) => string;
  /** Creates an edge between two handles and returns the generated edge ID. */
  connectNodes: (params: Connection) => string;
  /** Re-runs the layout engine and repositions all nodes. */
  layoutWorkflow: () => Promise<void>;
};

/** Presentation data for displaying workflow run status on nodes. */
export type NodeRunPresentation = {
  /** The ID of the currently displayed run, or `undefined` if no run is selected. */
  selectedRunId?: string;
  /** Map of node ID to its current run status. */
  nodeStatuses: Record<string, NodeRunStatus>;
  /** Async callback to fetch detailed run output/error information for a node tooltip. */
  getNodeRunTooltipDetails?: (nodeId: string) => Promise<NodeRunDetails>;
};

/**
 * Complete state exposed by the Fluxery editor context.
 *
 * Available via the {@link useFlow} hook. Contains theme, schemas, node handlers,
 * flow view props, editing APIs, run status, and more.
 *
 * @typeParam Context - Application-specific context type passed to node handlers.
 * @typeParam ExtraContext - Additional serializable data passed through the provider.
 */
export type FluxeryContextValue<
  Context extends object = object,
  ExtraContext extends JsonObject = JsonObject,
> = {
  /** The active editor color mode. */
  theme: FluxeryTheme;
  /** Registry of all available node schemas. */
  nodeSchemas: NodeSchemas;
  /** Optional registry of node handlers providing custom renderers and lifecycle callbacks. */
  nodeHandlers?: NodeHandlerRegistry<Context>;
  /** Optional registry of special field configurations for custom input rendering. */
  specialFields?: FluxerySpecialFields;
  /** Plugin configuration containing the TRPC base URL and endpoint. */
  pluginContext: PluginClientConfig;
  /** Application-specific extra context data passed through the provider. */
  extras: ExtraContext;
  /** Raw persisted workflow graph state. */
  workflow: FluxeryWorkflowState;
  /** The ID of the currently selected node, or `null` if none is selected. */
  selectedNode: string | null;
  /** The ID of the currently displayed workflow run. */
  selectedRunId?: string;
  /** Map of node ID to its current run status for the selected run. */
  nodeRunStatuses: Record<string, NodeRunStatus>;
  /** Async callback to fetch detailed run information for a node tooltip. */
  getNodeRunTooltipDetails?: (nodeId: string) => Promise<NodeRunDetails>;
  /** Sets the run presentation state (statuses, selected run, tooltip callback). */
  setNodeRunPresentation: (value: NodeRunPresentation) => void;
  /** Clears all run presentation state back to defaults. */
  clearNodeRunPresentation: () => void;
  /** Mock workflow data used for testing or preview purposes. */
  dummyWorkflowData?: WorkflowData;
  /** Setter for the mock workflow data state. */
  setDummyWorkflowData: React.Dispatch<React.SetStateAction<WorkflowData | undefined>>;
  /** Whether the editor is currently using mock workflow data. */
  useDummyWorkflow: boolean;
  /** Toggles mock workflow mode on or off. */
  setUseDummyWorkflow: React.Dispatch<React.SetStateAction<boolean>>;
  /** Re-runs the layout engine and repositions all nodes. */
  onLayout: () => Promise<void>;
  /** Runs the configured layout engine against an arbitrary graph snapshot. */
  layoutGraph: (nodes: Node[], edges: Edge[]) => Promise<{ nodes: Node[]; edges: Edge[] }>;
  /** Props to spread onto the React Flow canvas component. */
  flow: FluxeryFlowViewProps;
  /** Runtime for resolving node schemas given the current graph state. */
  nodeRuntime: NodeRuntime<Context>;
  /** Whether the editor is in read-only mode (no editing, connecting, or drag-drop). */
  isReadOnly: boolean;
  /** Imperative editing API, or `null` when in read-only mode. */
  editing: FluxeryEditingApi | null;
};

/** Props accepted by {@link FluxeryProvider}. */
export type FluxeryProviderProps<
  Context extends object,
  ExtraContext extends JsonObject = JsonObject,
> = {
  children: React.ReactNode;
  /** Initial workflow data used to seed local editor state on mount. Later prop changes do not reset the graph. */
  initialData?: WorkflowData;
  /** Callback fired after local workflow state changes (node/edge additions, updates, deletions). */
  onDataChange?: (data: WorkflowData) => void;
  /** Custom layout engine. Defaults to dagre if not provided. */
  layoutEngine?: LayoutEngine;
  /** Custom TanStack Query client. A shared singleton is created if omitted. */
  queryClient?: QueryClient;
  /** Color mode for the editor UI and React Flow canvas. */
  theme: FluxeryTheme;
  /** Registry of node schemas defining available node types and their input/output shapes. */
  nodeSchemas: NodeSchemas;
  /** Optional registry of node handlers for custom renderers, lifecycle callbacks, and configuration fields. */
  nodeHandlers?: NodeHandlerRegistry<Context>;
  /** Optional registry of special field configurations for custom input rendering. */
  specialFields?: FluxerySpecialFields;
  /** Plugin configuration containing the TRPC base URL and endpoint. */
  pluginContext: PluginClientConfig;
  /** JSON-serializable application context exposed at `useFlow().extras` and forwarded to node handlers. */
  extras: ExtraContext;
};

/** Props accepted by {@link PluginTRPCProvider}. */
export type PluginTRPCProviderProps = {
  children: React.ReactNode;
  /** Plugin configuration containing the TRPC base URL and endpoint. */
  pluginContext: PluginClientConfig;
  /** Custom TanStack Query client. A shared singleton is created if omitted. This provider exposes TRPC hooks only, not editor state. */
  queryClient?: QueryClient;
};

/** Interface for pluggable workflow layout algorithms (e.g. dagre, ELK). */
export type LayoutEngine = {
  /** Computes new positions for nodes and returns the repositioned graph. */
  layout: (nodes: Node[], edges: Edge[]) => Promise<{ nodes: Node[]; edges: Edge[] }>;
};
