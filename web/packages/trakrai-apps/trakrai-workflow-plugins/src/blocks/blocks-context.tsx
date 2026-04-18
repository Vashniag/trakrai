'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import {
  FluxeryCanvasProvider,
  FluxeryEditorActionsProvider,
  useFlow,
  useTRPCPluginAPIs,
  type FluxeryConfigRecord,
  type FluxeryFlowViewProps,
} from '@trakrai-workflow/ui';
import {
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import equal from 'fast-deep-equal';

import BlockNodeComponent from './block-node';
import {
  FLUXERY_BLOCK_NODE_TYPE,
  FLUXERY_BLOCK_TEMPLATE_MIME,
  applyDisplayedLayoutToRawNodes,
  buildBlockTemplateFromSelection,
  clearBlockSelection,
  createBlockFromSelection as applyBlockToSelection,
  getBlockInstanceSummary,
  getBlockMetadata,
  getSelectedBlockId,
  instantiateBlockTemplate,
  moveBlockNodes,
  parseSyntheticBlockNodeId,
  projectWorkflowWithBlocks,
  removeBlockFromWorkflow,
  resolveRawConnectionFromDisplayed,
  selectBlockNodes,
  updateBlockConfigFieldLabel as applyBlockConfigFieldLabel,
  updateBlockNodeLabel as applyBlockNodeLabel,
  updateBlockPortLabel as applyBlockPortLabel,
  withConnectionBlockMetadata,
  type FluxeryBlockConfigField,
  type FluxeryBlockDisplayState,
  type FluxeryBlockInstance,
  type FluxeryBlockPort,
  type FluxeryBlockTemplate,
} from './block-utils';

import type { BlocksPlugin } from './blocks-plugin';
import type { Node } from '@trakrai-workflow/core';

type BlocksContextValue = {
  canCreateFromSelection: boolean;
  createBlockFromSelection: (params: {
    name: string;
    template: FluxeryBlockTemplate;
  }) => string | null;
  buildTemplateFromSelection: (name: string) => FluxeryBlockTemplate | null;
  enterScope: (blockId: string) => void;
  exitScope: () => void;
  insertBlockTemplate: (params: {
    position: { x: number; y: number };
    template: FluxeryBlockTemplate;
  }) => string | null;
  scopedBlockId: string | null;
  selectedBlock: FluxeryBlockInstance | null;
  selectedBlockConfigFields: FluxeryBlockConfigField[];
  selectedBlockConfigValues: FluxeryConfigRecord;
  selectedBlockConnectedInputIds: string[];
  selectedBlockId: string | null;
  selectedBlockInputValues: FluxeryConfigRecord;
  selectedBlockInputs: FluxeryBlockPort[];
  selectedBlockOutputs: FluxeryBlockPort[];
  selectedNodeIds: string[];
  updateBlockConfigFieldLabel: (params: {
    blockId: string;
    key: string;
    label: string;
    nodeId: string;
  }) => void;
  updateBlockConfigValues: (values: FluxeryConfigRecord) => void;
  updateBlockInputValues: (values: FluxeryConfigRecord) => void;
  updateBlockNodeLabel: (params: { blockId: string; label: string; nodeId: string }) => void;
  updateBlockPortLabel: (params: {
    blockId: string;
    direction: 'input' | 'output';
    handle: string;
    label: string;
    nodeId: string;
  }) => void;
};

type BlockValueEntry = {
  key: string;
  nodeId: string;
  portId: string;
};

const BlocksContext = createContext<BlocksContextValue | null>(null);

const getConnectionBlockIds = (
  connection: Connection,
  nodes: Node[],
  scopedBlockId: string | null,
): string[] => {
  const blockIds = new Set<string>();
  if (scopedBlockId !== null) {
    blockIds.add(scopedBlockId);
  }

  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);
  const sourceBlockId =
    sourceNode === undefined ? undefined : getBlockMetadata(sourceNode)?.blockId;
  const targetBlockId =
    targetNode === undefined ? undefined : getBlockMetadata(targetNode)?.blockId;

  if (sourceBlockId !== undefined) {
    blockIds.add(sourceBlockId);
  }
  if (targetBlockId !== undefined) {
    blockIds.add(targetBlockId);
  }

  return Array.from(blockIds);
};

const groupEntriesByNodeId = (
  entries: BlockValueEntry[],
): Map<string, Array<{ key: string; portId: string }>> => {
  const entriesByNodeId = new Map<string, Array<{ key: string; portId: string }>>();

  for (const entry of entries) {
    const nodeEntries = entriesByNodeId.get(entry.nodeId);
    if (nodeEntries === undefined) {
      entriesByNodeId.set(entry.nodeId, [{ key: entry.key, portId: entry.portId }]);
      continue;
    }

    nodeEntries.push({ key: entry.key, portId: entry.portId });
  }

  return entriesByNodeId;
};

const applyValuesToNodes = (
  nodes: Node[],
  entriesByNodeId: Map<string, Array<{ key: string; portId: string }>>,
  values: FluxeryConfigRecord,
): Node[] =>
  nodes.map((node) => {
    const entries = entriesByNodeId.get(node.id);
    if (entries === undefined || entries.length === 0) {
      return node;
    }

    const nextConfiguration = { ...(node.data.configuration ?? {}) };
    let hasChange = false;

    for (const entry of entries) {
      if (!(entry.portId in values)) {
        continue;
      }

      nextConfiguration[entry.key] = values[entry.portId];
      hasChange = true;
    }

    if (!hasChange) {
      return node;
    }

    return {
      ...node,
      data: {
        ...node.data,
        configuration: nextConfiguration,
      },
    };
  });

/**
 * Projects the raw workflow into block-aware canvas state and exposes block editing actions.
 *
 * Wrap the editor surface with this provider before rendering block sidebar tabs, projected block
 * nodes, or calling {@link useBlocks}.
 */
export const BlocksProvider = ({ children }: { children: React.ReactNode }) => {
  const {
    workflow,
    flow: rawFlow,
    editing,
    layoutGraph,
    isReadOnly,
    useDummyWorkflow,
    dummyWorkflowData,
  } = useFlow();
  const queryClient = useQueryClient();
  const { client: trpc } = useTRPCPluginAPIs<BlocksPlugin>('blocks');
  const { screenToFlowPosition } = useReactFlow();
  const [scopedBlockId, setScopedBlockId] = useState<string | null>(null);
  const [blockDragPreviewStates, setBlockDragPreviewStates] = useState<
    Record<string, { dragging: boolean; position: { x: number; y: number } }>
  >({});
  const [blockDisplayStates, setBlockDisplayStates] = useState<
    Record<string, FluxeryBlockDisplayState>
  >({});
  const previousDisplayedNodesRef = useRef<Node[] | null>(null);

  const baseNodes =
    useDummyWorkflow && dummyWorkflowData !== undefined ? dummyWorkflowData.nodes : workflow.nodes;
  const baseEdges =
    useDummyWorkflow && dummyWorkflowData !== undefined ? dummyWorkflowData.edges : workflow.edges;

  const projection = useMemo(
    () =>
      projectWorkflowWithBlocks(
        baseNodes,
        baseEdges,
        scopedBlockId,
        blockDragPreviewStates,
        blockDisplayStates,
        previousDisplayedNodesRef.current ?? [],
      ),
    [baseEdges, baseNodes, blockDisplayStates, blockDragPreviewStates, scopedBlockId],
  );

  const selectedNodeIds = useMemo(
    () => workflow.nodes.filter((node) => node.selected === true).map((node) => node.id),
    [workflow.nodes],
  );

  const selectedBlockId = useMemo(
    () => getSelectedBlockId(workflow.nodes, projection.blockInstances, scopedBlockId),
    [projection.blockInstances, scopedBlockId, workflow.nodes],
  );

  const selectedBlock = useMemo(
    () => getBlockInstanceSummary(workflow.nodes, selectedBlockId),
    [selectedBlockId, workflow.nodes],
  );
  const selectedBlockConfigEntriesByNodeId = useMemo(
    () =>
      groupEntriesByNodeId(
        (selectedBlock?.configFields ?? []).map((field) => ({
          key: field.key,
          nodeId: field.nodeId,
          portId: field.portId,
        })),
      ),
    [selectedBlock],
  );
  const selectedBlockInputEntriesByNodeId = useMemo(
    () =>
      groupEntriesByNodeId(
        (selectedBlock?.inputs ?? []).map((input) => ({
          key: input.handle,
          nodeId: input.nodeId,
          portId: input.portId,
        })),
      ),
    [selectedBlock],
  );

  const selectedBlockConfigValues = useMemo<FluxeryConfigRecord>(() => {
    if (selectedBlock === null) {
      return {};
    }
    return Object.fromEntries(
      selectedBlock.configFields.map((field) => {
        const node = workflow.nodes.find((currentNode) => currentNode.id === field.nodeId);
        return [field.portId, node?.data.configuration?.[field.key] as FluxeryConfigRecord[string]];
      }),
    );
  }, [selectedBlock, workflow.nodes]);

  const selectedBlockConnectedInputIds = useMemo(() => {
    if (selectedBlock === null) {
      return [];
    }

    const blockNodeIds = new Set(selectedBlock.nodes.map((node) => node.id));
    const inputIdsByTarget = new Map(
      selectedBlock.inputs.map((port) => [`${port.nodeId}::${port.handle}`, port.portId] as const),
    );
    const connectedInputIds = new Set<string>();

    for (const edge of workflow.edges) {
      if (
        edge.targetHandle === undefined ||
        edge.targetHandle === null ||
        edge.targetHandle === '' ||
        !blockNodeIds.has(edge.target) ||
        blockNodeIds.has(edge.source)
      ) {
        continue;
      }

      const portId = inputIdsByTarget.get(`${edge.target}::${edge.targetHandle}`);
      if (portId !== undefined) {
        connectedInputIds.add(portId);
      }
    }

    return Array.from(connectedInputIds);
  }, [selectedBlock, workflow.edges]);

  const selectedBlockInputValues = useMemo<FluxeryConfigRecord>(() => {
    if (selectedBlock === null) {
      return {};
    }
    const connectedInputIds = new Set(selectedBlockConnectedInputIds);
    return Object.fromEntries(
      selectedBlock.inputs.flatMap((port) => {
        if (connectedInputIds.has(port.portId)) {
          return [];
        }
        const node = workflow.nodes.find((currentNode) => currentNode.id === port.nodeId);
        return [
          [port.portId, node?.data.configuration?.[port.handle] as FluxeryConfigRecord[string]],
        ];
      }),
    );
  }, [selectedBlock, selectedBlockConnectedInputIds, workflow.nodes]);

  const displayedNodes = useMemo(() => {
    const previousNodesById = new Map(
      (previousDisplayedNodesRef.current ?? []).map((node) => [node.id, node]),
    );
    const nextDisplayedNodes = projection.displayedNodes.map((node) => {
      const blockId = parseSyntheticBlockNodeId(node.id);
      if (blockId === null) {
        return node;
      }
      const previousNode = previousNodesById.get(node.id);
      return previousNode !== undefined && equal(previousNode, node) ? previousNode : node;
    });

    previousDisplayedNodesRef.current = nextDisplayedNodes;
    return nextDisplayedNodes;
  }, [projection.displayedNodes]);

  const buildTemplateFromSelection = useCallback(
    (name: string) =>
      buildBlockTemplateFromSelection(workflow.nodes, workflow.edges, selectedNodeIds, name),
    [selectedNodeIds, workflow.edges, workflow.nodes],
  );

  const createBlockFromSelection = useCallback(
    ({ name, template }: { name: string; template: FluxeryBlockTemplate }) => {
      if (selectedNodeIds.length < 2 || scopedBlockId !== null) {
        return null;
      }

      const blockId = crypto.randomUUID();
      const nextState = applyBlockToSelection({
        blockId,
        edges: workflow.edges,
        name,
        nodes: workflow.nodes,
        selectedNodeIds,
        template,
      });
      workflow.setNodes(nextState.nodes);
      workflow.setEdges(nextState.edges);
      return blockId;
    },
    [scopedBlockId, selectedNodeIds, workflow],
  );

  const insertBlockTemplate = useCallback(
    ({
      position,
      template,
    }: {
      position: { x: number; y: number };
      template: FluxeryBlockTemplate;
    }) => {
      if (scopedBlockId !== null) {
        return null;
      }

      const blockId = crypto.randomUUID();
      const inserted = instantiateBlockTemplate({
        blockId,
        position,
        template,
      });

      workflow.setNodes((currentNodes) => clearBlockSelection(currentNodes).concat(inserted.nodes));
      workflow.setEdges((currentEdges) => currentEdges.concat(inserted.edges));

      return blockId;
    },
    [scopedBlockId, workflow],
  );

  const updateBlockConfigValues = useCallback(
    (values: FluxeryConfigRecord) => {
      if (selectedBlock === null) {
        return;
      }

      workflow.setNodes((currentNodes) =>
        applyValuesToNodes(currentNodes, selectedBlockConfigEntriesByNodeId, values),
      );
    },
    [selectedBlock, selectedBlockConfigEntriesByNodeId, workflow],
  );

  const updateBlockInputValues = useCallback(
    (values: FluxeryConfigRecord) => {
      if (selectedBlock === null) {
        return;
      }

      workflow.setNodes((currentNodes) =>
        applyValuesToNodes(currentNodes, selectedBlockInputEntriesByNodeId, values),
      );
    },
    [selectedBlock, selectedBlockInputEntriesByNodeId, workflow],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const blockRemovals = new Set<string>();
      const blockPreviewUpdates: Record<
        string,
        { dragging: boolean; position: { x: number; y: number } } | null
      > = {};
      const blockDisplayUpdates: Record<string, FluxeryBlockDisplayState | null> = {};
      const rawChanges: NodeChange<Node>[] = [];

      for (const change of changes) {
        const blockId =
          scopedBlockId === null && 'id' in change ? parseSyntheticBlockNodeId(change.id) : null;
        if (blockId === null) {
          rawChanges.push(change);
          continue;
        }

        if (change.type === 'position' && change.position !== undefined) {
          if (change.dragging === true) {
            blockPreviewUpdates[blockId] = {
              dragging: true,
              position: change.position,
            };
            continue;
          }

          blockPreviewUpdates[blockId] = null;
          const nextPosition = change.position;
          workflow.setNodes((currentNodes) =>
            moveBlockNodes(currentNodes, blockId, {
              x: nextPosition.x,
              y: nextPosition.y,
            }),
          );
          continue;
        }

        if (change.type === 'dimensions') {
          const previousDisplayState = blockDisplayStates[blockId];
          const nextMeasured =
            change.dimensions === undefined
              ? previousDisplayState?.measured
              : {
                  width: change.dimensions.width,
                  height: change.dimensions.height,
                };
          blockDisplayUpdates[blockId] = {
            height:
              change.setAttributes === true || change.setAttributes === 'height'
                ? change.dimensions?.height
                : (previousDisplayState?.height ?? nextMeasured?.height),
            measured: nextMeasured,
            resizing: change.resizing ?? previousDisplayState?.resizing,
            width:
              change.setAttributes === true || change.setAttributes === 'width'
                ? change.dimensions?.width
                : (previousDisplayState?.width ?? nextMeasured?.width),
          };
          continue;
        }

        if (change.type === 'select') {
          workflow.setNodes((currentNodes) =>
            selectBlockNodes(currentNodes, blockId, change.selected),
          );
          continue;
        }

        if (change.type === 'remove') {
          blockRemovals.add(blockId);
          blockPreviewUpdates[blockId] = null;
        }
      }

      if (rawChanges.length > 0) {
        rawFlow.onNodesChange?.(rawChanges);
      }

      if (Object.keys(blockPreviewUpdates).length > 0) {
        setBlockDragPreviewStates((current) => {
          const next = { ...current };
          for (const [blockId, position] of Object.entries(blockPreviewUpdates)) {
            if (position === null) {
              delete next[blockId];
              continue;
            }
            next[blockId] = position;
          }
          return next;
        });
      }

      if (Object.keys(blockDisplayUpdates).length > 0) {
        setBlockDisplayStates((current) => {
          const next = { ...current };
          for (const [blockId, displayState] of Object.entries(blockDisplayUpdates)) {
            if (displayState === null) {
              delete next[blockId];
              continue;
            }
            next[blockId] = displayState;
          }
          return next;
        });
      }

      if (blockRemovals.size > 0) {
        setBlockDisplayStates((current) => {
          const next = { ...current };
          for (const blockId of blockRemovals) {
            delete next[blockId];
          }
          return next;
        });
        workflow.setNodes((currentNodes) => {
          let nextNodes = currentNodes;
          for (const blockId of blockRemovals) {
            nextNodes = removeBlockFromWorkflow(nextNodes, workflow.edges, blockId).nodes;
          }
          return nextNodes;
        });
        workflow.setEdges((currentEdges) => {
          let nextEdges = currentEdges;
          for (const blockId of blockRemovals) {
            nextEdges = removeBlockFromWorkflow(workflow.nodes, nextEdges, blockId).edges;
          }
          return nextEdges;
        });
      }
    },
    [blockDisplayStates, rawFlow, scopedBlockId, workflow],
  );

  const onDrop: NonNullable<FluxeryFlowViewProps['onDrop']> = useCallback(
    async (event) => {
      const templateId = event.dataTransfer.getData(FLUXERY_BLOCK_TEMPLATE_MIME);
      if (templateId === '') {
        rawFlow.onDrop?.(event);
        return;
      }

      event.preventDefault();
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const template = await queryClient.fetchQuery(
        trpc.getBlockDefinition.queryOptions({ blockId: templateId }),
      );
      void insertBlockTemplate({
        position,
        template: {
          ...template,
          id: template.id ?? templateId,
        },
      });
    },
    [insertBlockTemplate, queryClient, rawFlow, screenToFlowPosition, trpc],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const displayedTargetBlockId = parseSyntheticBlockNodeId(params.target);
      const resolvedConnection = resolveRawConnectionFromDisplayed(params);
      if (resolvedConnection === null || editing === null) {
        return;
      }
      const edgeId = editing.connectNodes(resolvedConnection.connection);
      const { target, targetHandle } = resolvedConnection.connection;
      const blockIds = new Set<string>([
        ...resolvedConnection.blockIds,
        ...getConnectionBlockIds(resolvedConnection.connection, workflow.nodes, scopedBlockId),
      ]);
      if (edgeId === '' || blockIds.size === 0) {
        return;
      }
      if (displayedTargetBlockId !== null && targetHandle !== null) {
        workflow.setNodes((currentNodes) =>
          currentNodes.map((node) => {
            if (node.id !== target) {
              return node;
            }
            const currentConfiguration = node.data.configuration;
            if (
              currentConfiguration === null ||
              currentConfiguration === undefined ||
              Array.isArray(currentConfiguration) ||
              typeof currentConfiguration !== 'object' ||
              !(targetHandle in currentConfiguration)
            ) {
              return node;
            }
            const nextConfiguration = { ...currentConfiguration };
            delete nextConfiguration[targetHandle];
            return {
              ...node,
              data: {
                ...node.data,
                configuration: nextConfiguration,
              },
            };
          }),
        );
      }
      workflow.setEdges((currentEdges) =>
        currentEdges.map((edge) =>
          edge.id === edgeId ? withConnectionBlockMetadata(edge, Array.from(blockIds)) : edge,
        ),
      );
    },
    [editing, scopedBlockId, workflow],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const resolvedConnection = resolveRawConnectionFromDisplayed({
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? null,
        target: connection.target,
        targetHandle: connection.targetHandle ?? null,
      });
      if (resolvedConnection === null) {
        return false;
      }
      return rawFlow.isValidConnection(resolvedConnection.connection);
    },
    [rawFlow],
  );

  const blockNodeTypes = useMemo<NodeTypes>(
    () => ({
      [FLUXERY_BLOCK_NODE_TYPE]: BlockNodeComponent,
    }),
    [],
  );

  const onNodeDoubleClick = useCallback<NodeMouseHandler<Node>>((_event, node) => {
    const blockId = parseSyntheticBlockNodeId(node.id);
    if (blockId !== null) {
      setScopedBlockId(blockId);
    }
  }, []);

  const layoutWorkflow = useCallback(async () => {
    const { nodes: layoutedDisplayedNodes } = await layoutGraph(
      displayedNodes,
      projection.displayedEdges,
    );
    setBlockDragPreviewStates({});
    workflow.setNodes((currentNodes) =>
      applyDisplayedLayoutToRawNodes(currentNodes, layoutedDisplayedNodes),
    );
  }, [displayedNodes, layoutGraph, projection.displayedEdges, workflow]);

  const editingOverride = useMemo(
    () =>
      editing === null
        ? null
        : {
            ...editing,
            layoutWorkflow,
          },
    [editing, layoutWorkflow],
  );
  const canvasOverride = useMemo(
    () => ({
      flowView: {
        nodes: displayedNodes,
        edges: projection.displayedEdges,
        onNodesChange: isReadOnly ? undefined : onNodesChange,
        onEdgesChange: isReadOnly ? undefined : rawFlow.onEdgesChange,
        onConnect: isReadOnly ? undefined : onConnect,
        onDragOver: isReadOnly ? undefined : rawFlow.onDragOver,
        onDrop: isReadOnly ? undefined : onDrop,
        isValidConnection,
      } satisfies FluxeryFlowViewProps,
      nodeTypes: blockNodeTypes,
      onNodeDoubleClick,
    }),
    [
      blockNodeTypes,
      displayedNodes,
      isReadOnly,
      isValidConnection,
      onConnect,
      onDrop,
      onNodeDoubleClick,
      onNodesChange,
      projection.displayedEdges,
      rawFlow.onDragOver,
      rawFlow.onEdgesChange,
    ],
  );

  const value = useMemo<BlocksContextValue>(
    () => ({
      canCreateFromSelection:
        scopedBlockId === null &&
        selectedNodeIds.length > 1 &&
        workflow.nodes
          .filter((node) => selectedNodeIds.includes(node.id))
          .every((node) => getBlockMetadata(node) === undefined),
      createBlockFromSelection,
      buildTemplateFromSelection,
      enterScope: (blockId: string) => {
        setScopedBlockId(blockId);
      },
      exitScope: () => {
        setScopedBlockId(null);
      },
      insertBlockTemplate,
      scopedBlockId,
      selectedBlock,
      selectedBlockConfigFields: selectedBlock?.configFields ?? [],
      selectedBlockConfigValues,
      selectedBlockConnectedInputIds,
      selectedBlockId,
      selectedBlockInputValues,
      selectedBlockInputs: selectedBlock?.inputs ?? [],
      selectedBlockOutputs: selectedBlock?.outputs ?? [],
      selectedNodeIds,
      updateBlockConfigFieldLabel: ({ blockId, key, label, nodeId }) => {
        workflow.setNodes((currentNodes) =>
          applyBlockConfigFieldLabel(currentNodes, blockId, nodeId, key, label),
        );
      },
      updateBlockConfigValues,
      updateBlockInputValues,
      updateBlockNodeLabel: ({ blockId, label, nodeId }) => {
        workflow.setNodes((currentNodes) =>
          applyBlockNodeLabel(currentNodes, blockId, nodeId, label),
        );
      },
      updateBlockPortLabel: ({ blockId, direction, handle, label, nodeId }) => {
        workflow.setNodes((currentNodes) =>
          applyBlockPortLabel(currentNodes, blockId, nodeId, direction, handle, label),
        );
      },
    }),
    [
      buildTemplateFromSelection,
      createBlockFromSelection,
      insertBlockTemplate,
      scopedBlockId,
      selectedBlock,
      selectedBlockConfigValues,
      selectedBlockConnectedInputIds,
      selectedBlockId,
      selectedBlockInputValues,
      selectedNodeIds,
      updateBlockConfigValues,
      updateBlockInputValues,
      workflow,
    ],
  );

  return (
    <BlocksContext.Provider value={value}>
      <FluxeryCanvasProvider value={canvasOverride}>
        <FluxeryEditorActionsProvider value={{ editing: editingOverride }}>
          {children}
        </FluxeryEditorActionsProvider>
      </FluxeryCanvasProvider>
    </BlocksContext.Provider>
  );
};

/**
 * Reads the block projection state created by {@link BlocksProvider}.
 */
export const useBlocks = () => {
  const context = useContext(BlocksContext);
  if (context === null) {
    throw new Error('useBlocks must be used within a BlocksProvider');
  }
  return context;
};
