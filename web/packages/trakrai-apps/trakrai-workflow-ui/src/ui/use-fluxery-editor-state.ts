'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ConditionalEdgeType,
  ExecutionSuccessHandle,
  TriggerHandle,
  createNodeRuntime,
  type JsonObject,
  type Node,
  type TRPCClient,
  validateConnection,
} from '@trakrai-workflow/core';
import {
  addEdge as addReactFlowEdge,
  type Connection,
  type Edge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import equal from 'fast-deep-equal';

import { getLayoutEngine } from './layout';
import { FLUXERY_NODE_TYPE_MIME } from './node-dnd';
import { dispatchNodeMutationCallbacks, getNodeMutations } from './node-mutation-utils';
import { serializeWorkflowData } from './workflow-data-utils';

import type {
  FluxeryContextValue,
  FluxeryProviderProps,
  LayoutEngine,
  NodeRunPresentation,
} from './flow-types';

const defaultLayoutEngine = getLayoutEngine('dagre');

const EMPTY_WORKFLOW_DATA = { nodes: [], edges: [] };

const reportNodeMutationCallbackError = (error: unknown): void => {
  (
    globalThis as {
      reportError?: (error: unknown) => void;
    }
  ).reportError?.(error);
};

const areNodeStatusesEqual = (
  a: NodeRunPresentation['nodeStatuses'],
  b: NodeRunPresentation['nodeStatuses'],
) => {
  const aEntries = Object.entries(a);
  const bEntries = Object.entries(b);
  if (aEntries.length !== bEntries.length) {
    return false;
  }

  return aEntries.every(([nodeId, status]) => b[nodeId] === status);
};

/** Arguments for the internal editor state hook, derived from provider props plus TRPC client. */
type UseFluxeryEditorStateArgs<
  Context extends object,
  ExtraContext extends JsonObject = JsonObject,
> = Omit<FluxeryProviderProps<Context, ExtraContext>, 'children' | 'queryClient'> & {
  queryClient: NonNullable<FluxeryProviderProps<Context, ExtraContext>['queryClient']>;
  trpc: TRPCClient;
};

/**
 * Internal hook that manages the complete Fluxery editor state.
 *
 * Handles node/edge state, data serialization, mutation callbacks, run status,
 * drag-and-drop, layout, and connection validation. Returns a `FluxeryContextValue`
 * consumed by the `FluxeryContext` provider.
 *
 * @internal Not part of the public API — used by `FluxeryProvider`.
 */
export const useFluxeryEditorState = <
  Context extends object,
  ExtraContext extends JsonObject = JsonObject,
>({
  initialData,
  onDataChange,
  layoutEngine = defaultLayoutEngine as LayoutEngine,
  queryClient,
  trpc,
  ...rest
}: UseFluxeryEditorStateArgs<Context, ExtraContext>): FluxeryContextValue<
  Context,
  ExtraContext
> => {
  const initialWorkflowData = initialData ?? EMPTY_WORKFLOW_DATA;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialWorkflowData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialWorkflowData.edges);
  const { screenToFlowPosition } = useReactFlow();
  const previousDataRef = useRef<typeof initialWorkflowData | null>(null);
  const previousNodeMutationDataRef = useRef<typeof initialWorkflowData | null>(null);
  const nodeMutationCallbackQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [nodeRunPresentation, setNodeRunPresentationState] = useState<NodeRunPresentation>({
    selectedRunId: undefined,
    nodeStatuses: {},
  });
  const [dummyWorkflowData, setDummyWorkflowData] = useState<typeof initialWorkflowData>();
  const [useDummyWorkflow, setUseDummyWorkflow] = useState(false);

  const setNodeRunPresentation = useCallback((value: NodeRunPresentation) => {
    setNodeRunPresentationState((current) => {
      if (
        current.selectedRunId === value.selectedRunId &&
        current.getNodeRunTooltipDetails === value.getNodeRunTooltipDetails &&
        areNodeStatusesEqual(current.nodeStatuses, value.nodeStatuses)
      ) {
        return current;
      }

      return value;
    });
  }, []);

  const clearNodeRunPresentation = useCallback(() => {
    setNodeRunPresentationState({
      selectedRunId: undefined,
      nodeStatuses: {},
      getNodeRunTooltipDetails: undefined,
    });
  }, []);

  useEffect(() => {
    const currentData = serializeWorkflowData(nodes, edges);
    if (previousDataRef.current === null) {
      previousDataRef.current = currentData;
      return;
    }
    if (equal(previousDataRef.current, currentData)) {
      return;
    }

    previousDataRef.current = currentData;
    onDataChange?.(currentData);
  }, [edges, nodes, onDataChange]);

  useEffect(() => {
    const currentData = serializeWorkflowData(nodes, edges);
    const previousData = previousNodeMutationDataRef.current;
    previousNodeMutationDataRef.current = currentData;
    if (previousData === null || equal(previousData, currentData)) {
      return;
    }
    if (getNodeMutations(previousData, currentData).length === 0) {
      return;
    }

    nodeMutationCallbackQueueRef.current = nodeMutationCallbackQueueRef.current
      .catch(() => undefined)
      .then(() =>
        dispatchNodeMutationCallbacks({
          currentWorkflowData: currentData,
          previousWorkflowData: previousData,
          nodeHandlers: rest.nodeHandlers,
          extras: rest.extras,
          pluginContext: rest.pluginContext,
          queryClient,
          trpc,
        }),
      )
      .catch((error: unknown) => {
        reportNodeMutationCallbackError(error);
      });
  }, [edges, nodes, queryClient, rest.extras, rest.nodeHandlers, rest.pluginContext, trpc]);

  const nodeRuntime = useMemo(
    () =>
      createNodeRuntime({
        nodes,
        edges,
        nodeSchemas: rest.nodeSchemas,
        nodeHandlers: rest.nodeHandlers,
      }),
    [edges, nodes, rest.nodeHandlers, rest.nodeSchemas],
  );

  const connectNodes = useCallback(
    (params: Connection) => {
      const edgeType = params.targetHandle === TriggerHandle ? ConditionalEdgeType : undefined;
      const newEdgeId = crypto.randomUUID();
      const edgeData =
        params.targetHandle === TriggerHandle && params.sourceHandle === ExecutionSuccessHandle
          ? { configuration: true }
          : undefined;
      setEdges((currentEdges) =>
        addReactFlowEdge(
          { ...params, type: edgeType, animated: true, id: newEdgeId, data: edgeData },
          currentEdges,
        ),
      );

      return newEdgeId;
    },
    [setEdges],
  );

  const addNode = useCallback(
    ({
      type,
      position,
      data,
    }: {
      type: string;
      position: { x: number; y: number };
      data: { configuration?: Node['data']['configuration'] };
    }) => {
      const newNodeId = crypto.randomUUID();
      const newNode: Node = {
        id: newNodeId,
        type,
        position,
        data,
      };
      setNodes((currentNodes) => currentNodes.concat(newNode));
      return newNodeId;
    },
    [setNodes],
  );

  const onDragOver: React.DragEventHandler<HTMLDivElement> = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop: React.DragEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      event.preventDefault();
      const dragData = event.dataTransfer.getData(FLUXERY_NODE_TYPE_MIME);
      const fallbackData = event.dataTransfer.getData('text/plain');
      const nodeType = dragData !== '' ? dragData : fallbackData;
      if (nodeType === '') {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNode({ type: nodeType, position, data: {} });
    },
    [addNode, screenToFlowPosition],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => validateConnection(connection, nodes, edges, nodeRuntime),
    [edges, nodeRuntime, nodes],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.selected === true)?.id ?? null,
    [nodes],
  );

  const onLayout = useCallback(async () => {
    const { nodes: layoutedNodes } = await layoutEngine.layout(nodes, edges);
    setNodes([...layoutedNodes]);
  }, [edges, layoutEngine, nodes, setNodes]);

  const layoutGraph = useCallback(
    async (graphNodes: Node[], graphEdges: Edge[]) => {
      const result = await layoutEngine.layout(graphNodes, graphEdges);
      return {
        nodes: result.nodes,
        edges: result.edges,
      };
    },
    [layoutEngine],
  );

  const isReadOnly = nodeRunPresentation.selectedRunId !== undefined || useDummyWorkflow;
  const displayedNodes =
    useDummyWorkflow && dummyWorkflowData !== undefined ? dummyWorkflowData.nodes : nodes;
  const displayedEdges =
    useDummyWorkflow && dummyWorkflowData !== undefined ? dummyWorkflowData.edges : edges;

  const editing = useMemo(
    () =>
      isReadOnly
        ? null
        : {
            addNode,
            connectNodes,
            layoutWorkflow: onLayout,
          },
    [addNode, connectNodes, isReadOnly, onLayout],
  );

  const flow = useMemo(
    () => ({
      nodes: displayedNodes,
      edges: displayedEdges,
      onNodesChange: isReadOnly ? undefined : onNodesChange,
      onEdgesChange: isReadOnly ? undefined : onEdgesChange,
      onConnect: isReadOnly ? undefined : (params: Connection) => void connectNodes(params),
      onDragOver: isReadOnly ? undefined : onDragOver,
      onDrop: isReadOnly ? undefined : onDrop,
      isValidConnection,
    }),
    [
      connectNodes,
      displayedEdges,
      displayedNodes,
      isReadOnly,
      isValidConnection,
      onDragOver,
      onDrop,
      onEdgesChange,
      onNodesChange,
    ],
  );

  return {
    ...rest,
    workflow: {
      edges,
      nodes,
      setEdges,
      setNodes,
    },
    selectedNode,
    selectedRunId: nodeRunPresentation.selectedRunId,
    nodeRunStatuses: nodeRunPresentation.nodeStatuses,
    getNodeRunTooltipDetails: nodeRunPresentation.getNodeRunTooltipDetails,
    setNodeRunPresentation,
    clearNodeRunPresentation,
    dummyWorkflowData,
    setDummyWorkflowData,
    useDummyWorkflow,
    setUseDummyWorkflow,
    onLayout,
    layoutGraph,
    flow,
    nodeRuntime,
    isReadOnly,
    editing,
  };
};
