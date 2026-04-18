import { createDisplayName } from '@trakrai-workflow/core/utils';
import equal from 'fast-deep-equal';

import type { Edge, Node } from '@trakrai-workflow/core';
import type { Connection } from '@xyflow/react';

/**
 * Synthetic node type used when a workflow is projected into higher-level block instances.
 */
export const FLUXERY_BLOCK_NODE_TYPE = '__fluxery_block__';
/**
 * MIME type used for serialized block template drag-and-drop and clipboard payloads.
 */
export const FLUXERY_BLOCK_TEMPLATE_MIME = 'application/x-fluxery-block-template';

const BLOCK_HANDLE_SEPARATOR = '::';
const BLOCK_INPUT_HANDLE_PREFIX = 'block-input';
const BLOCK_OUTPUT_HANDLE_PREFIX = 'block-output';
const BLOCK_ID_LABEL_LENGTH = 8;

export type FluxeryBlockPort = {
  direction: 'input' | 'output';
  handle: string;
  label: string;
  nodeId: string;
  nodeLabel: string;
  nodeType?: string;
  portId: string;
};

export type FluxeryBlockConfigField = {
  key: string;
  label: string;
  nodeId: string;
  nodeLabel: string;
  nodeType?: string;
  portId: string;
};

/**
 * Serializable snapshot of a reusable block definition.
 *
 * Template node positions are stored relative to the selection origin so the block can be
 * instantiated at any canvas position later.
 */
export type FluxeryBlockTemplate = {
  id?: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  inputs: FluxeryBlockPort[];
  outputs: FluxeryBlockPort[];
  configFields: FluxeryBlockConfigField[];
};

/**
 * Metadata stored on raw workflow nodes that belong to a block instance.
 *
 * These labels and template references let the block projection layer render friendly block-level
 * names without mutating the underlying node schemas.
 */
export type FluxeryBlockNodeMetadata = {
  blockId: string;
  configLabels?: Record<string, string>;
  inputLabels?: Record<string, string>;
  nodeLabel?: string;
  outputLabels?: Record<string, string>;
  templateId?: string;
  templateName?: string;
};

export type FluxeryBlockEdgeMetadata = {
  blockIds: string[];
};

/**
 * Runtime summary of one block instance currently present in the workflow graph.
 */
export type FluxeryBlockInstance = {
  blockId: string;
  configFields: FluxeryBlockConfigField[];
  inputs: FluxeryBlockPort[];
  name: string;
  nodeIds: string[];
  nodes: Node[];
  outputs: FluxeryBlockPort[];
  templateId?: string;
};

export type FluxeryBlockProjection = {
  blockInstances: Map<string, FluxeryBlockInstance>;
  displayedEdges: Edge[];
  displayedNodes: Node[];
};

export type FluxeryBlockDragPreviewState = {
  dragging: boolean;
  position: { x: number; y: number };
};

export type FluxeryBlockDisplayState = {
  height?: number;
  measured?: {
    height?: number;
    width?: number;
  };
  resizing?: boolean;
  width?: number;
};

type NodeWithBlockData = Node['data'] & {
  block?: FluxeryBlockNodeMetadata;
  title?: string;
};

type EdgeWithBlockData = NonNullable<Edge['data']> & {
  block?: FluxeryBlockEdgeMetadata;
  rawEdgeId?: string;
};

type BlockNodeDisplayData = NodeWithBlockData & {
  blockId: string;
  configFields: FluxeryBlockConfigField[];
  configuredTargetPortIds: string[];
  inputs: FluxeryBlockPort[];
  nodeCount: number;
  outputs: FluxeryBlockPort[];
  title: string;
};

const hasObjectValue = (value: unknown): value is Record<string, unknown> =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);

/**
 * Reads the block metadata previously attached to a raw workflow node.
 */
export const getBlockMetadata = (node: Node): FluxeryBlockNodeMetadata | undefined => {
  const nodeData = node.data as NodeWithBlockData;
  if (!hasObjectValue(nodeData.block)) {
    return undefined;
  }
  const { blockId } = nodeData.block;
  if (typeof blockId !== 'string' || blockId.length === 0) {
    return undefined;
  }
  return nodeData.block;
};

const getBlockIdsFromEdgeData = (edge: Edge): string[] => {
  const edgeData = edge.data as EdgeWithBlockData | undefined;
  const blockIds = edgeData?.block?.blockIds;
  if (!Array.isArray(blockIds)) {
    return [];
  }
  return blockIds.filter((blockId): blockId is string => typeof blockId === 'string');
};

/**
 * Attaches or removes block metadata on a raw workflow node without disturbing the rest of its data.
 */
export const attachBlockMetadataToNode = (
  node: Node,
  block: FluxeryBlockNodeMetadata | undefined,
): Node => {
  const nodeData = node.data as NodeWithBlockData;
  if (block === undefined) {
    const { block: _unused, ...rest } = nodeData;
    return {
      ...node,
      data: rest,
    };
  }
  return {
    ...node,
    data: {
      ...nodeData,
      block,
    },
  };
};

const setEdgeBlockIds = (edge: Edge, blockIds: string[]): Edge => {
  const uniqueBlockIds = Array.from(new Set(blockIds));
  const edgeData = (edge.data ?? {}) as EdgeWithBlockData;
  if (uniqueBlockIds.length === 0) {
    const { block: _unused, ...rest } = edgeData;
    return {
      ...edge,
      data: Object.keys(rest).length === 0 ? undefined : rest,
    };
  }
  return {
    ...edge,
    data: {
      ...edgeData,
      block: {
        blockIds: uniqueBlockIds,
      },
    },
  };
};

const getNodeDataTitle = (node: Node): string | undefined => {
  const { title } = node.data as NodeWithBlockData;
  return typeof title === 'string' && title.length > 0 ? title : undefined;
};

const getDefaultNodeLabel = (node: Node): string => {
  const dataTitle = getNodeDataTitle(node);
  if (dataTitle !== undefined) {
    return dataTitle;
  }
  const existingLabel = getBlockMetadata(node)?.nodeLabel;
  if (typeof existingLabel === 'string' && existingLabel.length > 0) {
    return existingLabel;
  }
  return createDisplayName(node.type ?? node.id);
};

const getDefaultPortLabel = (node: Node, handle: string): string =>
  `${getDefaultNodeLabel(node)} · ${createDisplayName(handle)}`;

const getDefaultConfigLabel = (node: Node, key: string): string =>
  `${getDefaultNodeLabel(node)} · ${createDisplayName(key)}`;

const buildPortId = (nodeId: string, handle: string): string =>
  `${nodeId}${BLOCK_HANDLE_SEPARATOR}${handle}`;

/**
 * Encodes an original node handle so a projected block node can still route connections back to the
 * underlying raw workflow node and port.
 */
export const buildBlockHandleId = (
  direction: 'input' | 'output',
  nodeId: string,
  handle: string,
): string =>
  `${direction === 'input' ? BLOCK_INPUT_HANDLE_PREFIX : BLOCK_OUTPUT_HANDLE_PREFIX}${BLOCK_HANDLE_SEPARATOR}${nodeId}${BLOCK_HANDLE_SEPARATOR}${handle}`;

/**
 * Reverses {@link buildBlockHandleId}. Returns `null` for handles that do not belong to a projected
 * block node.
 */
export const parseBlockHandleId = (
  handleId: string | null | undefined,
): { direction: 'input' | 'output'; nodeId: string; handle: string } | null => {
  if (typeof handleId !== 'string') {
    return null;
  }
  const [prefix, nodeId, ...handleParts] = handleId.split(BLOCK_HANDLE_SEPARATOR);
  if (
    (prefix !== BLOCK_INPUT_HANDLE_PREFIX && prefix !== BLOCK_OUTPUT_HANDLE_PREFIX) ||
    nodeId === undefined ||
    nodeId === ''
  ) {
    return null;
  }
  const handle = handleParts.join(BLOCK_HANDLE_SEPARATOR);
  if (handle === '') {
    return null;
  }
  return {
    direction: prefix === BLOCK_INPUT_HANDLE_PREFIX ? 'input' : 'output',
    nodeId,
    handle,
  };
};

const getSyntheticBlockNodeId = (blockId: string) =>
  `${FLUXERY_BLOCK_NODE_TYPE}${BLOCK_HANDLE_SEPARATOR}${blockId}`;

/**
 * Returns the backing block id for a projected synthetic block node id.
 */
export const parseSyntheticBlockNodeId = (nodeId: string | null | undefined): string | null => {
  if (typeof nodeId !== 'string') {
    return null;
  }
  const prefix = `${FLUXERY_BLOCK_NODE_TYPE}${BLOCK_HANDLE_SEPARATOR}`;
  if (!nodeId.startsWith(prefix)) {
    return null;
  }
  return nodeId.slice(prefix.length);
};

/**
 * Detects whether a node belongs to the projected block layer rather than the raw workflow graph.
 */
export const isBlockNode = (node: Pick<Node, 'type'> | undefined): boolean =>
  node?.type === FLUXERY_BLOCK_NODE_TYPE;

const getSelectedNodeIds = (nodes: Node[]): string[] =>
  nodes.filter((node) => node.selected === true).map((node) => node.id);

const toBlockPortList = (
  nodes: Node[],
  mapper: (node: Node, metadata: FluxeryBlockNodeMetadata) => Record<string, string> | undefined,
  direction: 'input' | 'output',
): FluxeryBlockPort[] => {
  const ports: FluxeryBlockPort[] = [];
  for (const node of nodes) {
    const metadata = getBlockMetadata(node);
    if (metadata === undefined) {
      continue;
    }
    const portLabels = mapper(node, metadata);
    if (portLabels === undefined) {
      continue;
    }
    for (const [handle, label] of Object.entries(portLabels)) {
      ports.push({
        direction,
        handle,
        label,
        nodeId: node.id,
        nodeLabel: getDefaultNodeLabel(node),
        nodeType: node.type,
        portId: buildPortId(node.id, handle),
      });
    }
  }
  return ports.sort((a, b) => a.label.localeCompare(b.label));
};

const toBlockConfigFieldList = (nodes: Node[]): FluxeryBlockConfigField[] => {
  const fields: FluxeryBlockConfigField[] = [];
  for (const node of nodes) {
    const metadata = getBlockMetadata(node);
    if (metadata?.configLabels === undefined) {
      continue;
    }
    for (const [key, label] of Object.entries(metadata.configLabels)) {
      fields.push({
        key,
        label,
        nodeId: node.id,
        nodeLabel: getDefaultNodeLabel(node),
        nodeType: node.type,
        portId: buildPortId(node.id, key),
      });
    }
  }
  return fields.sort((a, b) => a.label.localeCompare(b.label));
};

const collectBlockInstances = (nodes: Node[]): Map<string, FluxeryBlockInstance> => {
  const instances = new Map<string, FluxeryBlockInstance>();
  for (const node of nodes) {
    const metadata = getBlockMetadata(node);
    if (metadata === undefined) {
      continue;
    }
    const current = instances.get(metadata.blockId);
    if (current === undefined) {
      instances.set(metadata.blockId, {
        blockId: metadata.blockId,
        configFields: [],
        inputs: [],
        name: metadata.templateName ?? `Block ${metadata.blockId.slice(0, BLOCK_ID_LABEL_LENGTH)}`,
        nodeIds: [node.id],
        nodes: [node],
        outputs: [],
        templateId: metadata.templateId,
      });
      continue;
    }
    current.nodeIds.push(node.id);
    current.nodes.push(node);
  }

  for (const instance of instances.values()) {
    instance.inputs = toBlockPortList(
      instance.nodes,
      (_node, metadata) => metadata.inputLabels,
      'input',
    );
    instance.outputs = toBlockPortList(
      instance.nodes,
      (_node, metadata) => metadata.outputLabels,
      'output',
    );
    instance.configFields = toBlockConfigFieldList(instance.nodes);
    instance.nodes.sort((a, b) => a.id.localeCompare(b.id));
    instance.nodeIds.sort((a, b) => a.localeCompare(b));
  }

  return instances;
};

const getBlockAnchorPosition = (nodes: Node[]) => {
  return nodes.reduce(
    (acc, node) => ({
      x: Math.min(acc.x, node.position.x),
      y: Math.min(acc.y, node.position.y),
    }),
    { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
  );
};

const getVisibleBlockSelection = (
  blockInstance: FluxeryBlockInstance,
  selectedNodeIds: string[],
): boolean =>
  selectedNodeIds.length > 0 &&
  blockInstance.nodeIds.every((nodeId) => selectedNodeIds.includes(nodeId));

const getConfiguredBlockTargetPortIds = (blockInstance: FluxeryBlockInstance): string[] => {
  const configuredPortIds = new Set<string>();

  for (const node of blockInstance.nodes) {
    const metadata = getBlockMetadata(node);
    const configuration = hasObjectValue(node.data.configuration) ? node.data.configuration : null;
    if (metadata === undefined || configuration === null) {
      continue;
    }

    for (const handle of Object.keys(metadata.inputLabels ?? {})) {
      if (handle in configuration) {
        configuredPortIds.add(buildPortId(node.id, handle));
      }
    }

    for (const key of Object.keys(metadata.configLabels ?? {})) {
      if (key in configuration) {
        configuredPortIds.add(buildPortId(node.id, key));
      }
    }
  }

  return Array.from(configuredPortIds).sort((a, b) => a.localeCompare(b));
};

export const getSelectedBlockId = (
  nodes: Node[],
  blockInstances: Map<string, FluxeryBlockInstance>,
  scopedBlockId: string | null,
): string | null => {
  if (scopedBlockId !== null) {
    return scopedBlockId;
  }
  const selectedIds = getSelectedNodeIds(nodes);
  if (selectedIds.length === 0) {
    return null;
  }
  for (const [blockId, blockInstance] of blockInstances.entries()) {
    if (
      selectedIds.length === blockInstance.nodeIds.length &&
      blockInstance.nodeIds.every((nodeId) => selectedIds.includes(nodeId))
    ) {
      return blockId;
    }
  }
  return null;
};

const toDisplayedBlockNode = (
  blockInstance: FluxeryBlockInstance,
  selectedNodeIds: string[],
  previewState?: FluxeryBlockDragPreviewState,
  displayState?: FluxeryBlockDisplayState,
  previousNode?: Node,
): Node => {
  const anchor = getBlockAnchorPosition(blockInstance.nodes);
  const title = blockInstance.name;
  const nextData: BlockNodeDisplayData = {
    blockId: blockInstance.blockId,
    configFields: blockInstance.configFields,
    configuredTargetPortIds: getConfiguredBlockTargetPortIds(blockInstance),
    inputs: blockInstance.inputs,
    nodeCount: blockInstance.nodes.length,
    outputs: blockInstance.outputs,
    title,
  };
  const previousDisplayData =
    previousNode === undefined
      ? null
      : getBlockDisplayData({ data: previousNode.data, type: previousNode.type });
  const data =
    previousNode !== undefined &&
    previousDisplayData !== null &&
    equal(previousDisplayData, nextData)
      ? previousNode.data
      : nextData;
  const measured = displayState?.measured ?? previousNode?.measured;
  const width = displayState?.width ?? previousNode?.width ?? measured?.width;
  const height = displayState?.height ?? previousNode?.height ?? measured?.height;

  return {
    id: getSyntheticBlockNodeId(blockInstance.blockId),
    type: FLUXERY_BLOCK_NODE_TYPE,
    dragging: previewState?.dragging ?? false,
    height,
    measured,
    position: previewState?.position ?? anchor,
    resizing: displayState?.resizing ?? previousNode?.resizing,
    selected: getVisibleBlockSelection(blockInstance, selectedNodeIds),
    data,
    width,
  };
};

export const getBlockInstanceSummary = (
  nodes: Node[],
  blockId: string | null,
): FluxeryBlockInstance | null => {
  if (blockId === null) {
    return null;
  }
  const blockInstances = collectBlockInstances(nodes);
  return blockInstances.get(blockId) ?? null;
};

const toDisplayedBoundaryEdge = (
  edge: Edge,
  sourceBlockId: string | null,
  targetBlockId: string | null,
): Edge | null => {
  if (sourceBlockId !== null && targetBlockId !== null && sourceBlockId === targetBlockId) {
    return null;
  }

  const sourceHandle =
    sourceBlockId === null
      ? edge.sourceHandle
      : buildBlockHandleId('output', edge.source, edge.sourceHandle ?? '');
  const targetHandle =
    targetBlockId === null
      ? edge.targetHandle
      : buildBlockHandleId('input', edge.target, edge.targetHandle ?? '');

  if (
    (sourceBlockId !== null && (edge.sourceHandle === undefined || edge.sourceHandle === '')) ||
    (targetBlockId !== null && (edge.targetHandle === undefined || edge.targetHandle === ''))
  ) {
    return null;
  }

  return {
    ...edge,
    source: sourceBlockId === null ? edge.source : getSyntheticBlockNodeId(sourceBlockId),
    sourceHandle,
    target: targetBlockId === null ? edge.target : getSyntheticBlockNodeId(targetBlockId),
    targetHandle,
    data: {
      ...(edge.data as EdgeWithBlockData | undefined),
      rawEdgeId: edge.id,
    },
  };
};

/**
 * Projects a raw workflow into the displayed graph used by the block-aware editor.
 *
 * When no block is scoped, raw nodes that belong to the same block are collapsed into one synthetic
 * block node and boundary edges are rewritten to use encoded block handles. When a block is scoped,
 * only that block's raw nodes and internal edges remain visible.
 */
export const projectWorkflowWithBlocks = (
  nodes: Node[],
  edges: Edge[],
  scopedBlockId: string | null,
  blockDragPreviewStates: Record<string, FluxeryBlockDragPreviewState> = {},
  blockDisplayStates: Record<string, FluxeryBlockDisplayState> = {},
  previousDisplayedNodes: Node[] = [],
): FluxeryBlockProjection => {
  if (scopedBlockId !== null) {
    const scopedNodeIds = new Set(
      nodes
        .filter((node) => getBlockMetadata(node)?.blockId === scopedBlockId)
        .map((node) => node.id),
    );
    return {
      blockInstances: collectBlockInstances(nodes),
      displayedEdges: edges.filter(
        (edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target),
      ),
      displayedNodes: nodes.filter((node) => scopedNodeIds.has(node.id)),
    };
  }

  const blockInstances = collectBlockInstances(nodes);
  const previousDisplayedNodesById = new Map(previousDisplayedNodes.map((node) => [node.id, node]));
  const selectedNodeIds = getSelectedNodeIds(nodes);
  const nodeBlockIdMap = new Map<string, string>();
  for (const [blockId, blockInstance] of blockInstances.entries()) {
    for (const nodeId of blockInstance.nodeIds) {
      nodeBlockIdMap.set(nodeId, blockId);
    }
  }

  const displayedNodes = nodes.filter((node) => !nodeBlockIdMap.has(node.id));
  displayedNodes.push(
    ...Array.from(blockInstances.values()).map((blockInstance) =>
      toDisplayedBlockNode(
        blockInstance,
        selectedNodeIds,
        blockDragPreviewStates[blockInstance.blockId],
        blockDisplayStates[blockInstance.blockId],
        previousDisplayedNodesById.get(getSyntheticBlockNodeId(blockInstance.blockId)),
      ),
    ),
  );

  const displayedEdges = edges.flatMap((edge) => {
    const displayedEdge = toDisplayedBoundaryEdge(
      edge,
      nodeBlockIdMap.get(edge.source) ?? null,
      nodeBlockIdMap.get(edge.target) ?? null,
    );
    return displayedEdge === null ? [] : [displayedEdge];
  });

  return {
    blockInstances,
    displayedEdges,
    displayedNodes,
  };
};

const setNodeSelection = (node: Node, selected: boolean): Node => ({
  ...node,
  selected,
});

/**
 * Mirrors selection changes from a displayed block node back onto all raw nodes inside that block.
 */
export const selectBlockNodes = (nodes: Node[], blockId: string, selected: boolean): Node[] =>
  nodes.map((node) => {
    const nodeBlockId = getBlockMetadata(node)?.blockId;
    if (nodeBlockId === blockId) {
      return setNodeSelection(node, selected);
    }
    return selected ? setNodeSelection(node, false) : node;
  });

/**
 * Repositions every raw node inside a block by the delta between the current and desired block
 * anchor positions.
 */
export const moveBlockNodes = (
  nodes: Node[],
  blockId: string,
  nextPosition: { x: number; y: number },
): Node[] => {
  const blockNodes = nodes.filter((node) => getBlockMetadata(node)?.blockId === blockId);
  if (blockNodes.length === 0) {
    return nodes;
  }
  const currentAnchor = getBlockAnchorPosition(blockNodes);
  const deltaX = nextPosition.x - currentAnchor.x;
  const deltaY = nextPosition.y - currentAnchor.y;
  return nodes.map((node) => {
    if (getBlockMetadata(node)?.blockId !== blockId) {
      return node;
    }
    return {
      ...node,
      position: {
        x: node.position.x + deltaX,
        y: node.position.y + deltaY,
      },
    };
  });
};

/**
 * Applies positions from the displayed graph back onto the raw workflow nodes after layout or drag
 * operations, translating synthetic block nodes into per-node movement.
 */
export const applyDisplayedLayoutToRawNodes = (nodes: Node[], displayedNodes: Node[]): Node[] => {
  let nextNodes = nodes;

  for (const displayedNode of displayedNodes) {
    const blockId = parseSyntheticBlockNodeId(displayedNode.id);
    if (blockId !== null) {
      nextNodes = moveBlockNodes(nextNodes, blockId, displayedNode.position);
      continue;
    }

    nextNodes = nextNodes.map((node) =>
      node.id === displayedNode.id
        ? {
            ...node,
            position: displayedNode.position,
            sourcePosition: displayedNode.sourcePosition,
            targetPosition: displayedNode.targetPosition,
          }
        : node,
    );
  }

  return nextNodes;
};

/**
 * Removes all raw nodes and edges that belong to a block instance.
 */
export const removeBlockFromWorkflow = (
  nodes: Node[],
  edges: Edge[],
  blockId: string,
): { nodes: Node[]; edges: Edge[] } => {
  const nodeIds = new Set(
    nodes.filter((node) => getBlockMetadata(node)?.blockId === blockId).map((node) => node.id),
  );

  return {
    nodes: nodes.filter((node) => !nodeIds.has(node.id)),
    edges: edges.filter((edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
  };
};

/**
 * Clears raw node selection state before selecting or instantiating a different block.
 */
export const clearBlockSelection = (nodes: Node[]): Node[] =>
  nodes.map((node) => ({
    ...node,
    selected: false,
  }));

/**
 * Builds a reusable block template from a multi-node selection.
 *
 * The selection must contain at least two raw nodes and cannot already include nodes that belong to
 * an existing block instance.
 */
export const buildBlockTemplateFromSelection = (
  nodes: Node[],
  edges: Edge[],
  selectedNodeIds: string[],
  name: string,
): FluxeryBlockTemplate | null => {
  const selectedSet = new Set(selectedNodeIds);
  if (selectedSet.size < 2) {
    return null;
  }

  const selectedNodes = nodes.filter((node) => selectedSet.has(node.id));
  if (selectedNodes.some((node) => getBlockMetadata(node) !== undefined)) {
    return null;
  }

  const minX = selectedNodes.reduce(
    (acc, node) => Math.min(acc, node.position.x),
    Number.POSITIVE_INFINITY,
  );
  const minY = selectedNodes.reduce(
    (acc, node) => Math.min(acc, node.position.y),
    Number.POSITIVE_INFINITY,
  );

  const clonedNodes = selectedNodes.map((node) => {
    const { block: _unused, ...nodeData } = node.data as NodeWithBlockData;
    return {
      ...node,
      position: {
        x: node.position.x - minX,
        y: node.position.y - minY,
      },
      selected: false,
      data: nodeData,
    };
  });

  const clonedEdges = edges
    .filter((edge) => selectedSet.has(edge.source) && selectedSet.has(edge.target))
    .map((edge) => setEdgeBlockIds({ ...edge, selected: false }, []));

  const boundaryInputs = edges.filter(
    (edge) => !selectedSet.has(edge.source) && selectedSet.has(edge.target),
  );
  const boundaryOutputs = edges.filter(
    (edge) => selectedSet.has(edge.source) && !selectedSet.has(edge.target),
  );

  const inputs = Array.from(
    new Map(
      boundaryInputs.flatMap((edge) => {
        const targetNode = selectedNodes.find((node) => node.id === edge.target);
        if (
          targetNode === undefined ||
          edge.targetHandle === undefined ||
          edge.targetHandle === null ||
          edge.targetHandle === ''
        ) {
          return [];
        }
        const label = getDefaultPortLabel(targetNode, edge.targetHandle);
        const port: FluxeryBlockPort = {
          direction: 'input',
          handle: edge.targetHandle,
          label,
          nodeId: targetNode.id,
          nodeLabel: getDefaultNodeLabel(targetNode),
          nodeType: targetNode.type,
          portId: buildPortId(targetNode.id, edge.targetHandle),
        };
        return [[port.portId, port] as const];
      }),
    ).values(),
  );

  const outputs = Array.from(
    new Map(
      boundaryOutputs.flatMap((edge) => {
        const sourceNode = selectedNodes.find((node) => node.id === edge.source);
        if (
          sourceNode === undefined ||
          edge.sourceHandle === undefined ||
          edge.sourceHandle === null ||
          edge.sourceHandle === ''
        ) {
          return [];
        }
        const label = getDefaultPortLabel(sourceNode, edge.sourceHandle);
        const port: FluxeryBlockPort = {
          direction: 'output',
          handle: edge.sourceHandle,
          label,
          nodeId: sourceNode.id,
          nodeLabel: getDefaultNodeLabel(sourceNode),
          nodeType: sourceNode.type,
          portId: buildPortId(sourceNode.id, edge.sourceHandle),
        };
        return [[port.portId, port] as const];
      }),
    ).values(),
  );

  const configFields = Array.from(
    new Map(
      selectedNodes.flatMap((node) => {
        const { configuration } = node.data;
        if (!hasObjectValue(configuration)) {
          return [];
        }
        return Object.keys(configuration).map((key) => {
          const field: FluxeryBlockConfigField = {
            key,
            label: getDefaultConfigLabel(node, key),
            nodeId: node.id,
            nodeLabel: getDefaultNodeLabel(node),
            nodeType: node.type,
            portId: buildPortId(node.id, key),
          };
          return [field.portId, field] as const;
        });
      }),
    ).values(),
  );

  return {
    name,
    nodes: clonedNodes,
    edges: clonedEdges,
    inputs,
    outputs,
    configFields,
  };
};

const getTemplateNodeMetadata = (
  template: FluxeryBlockTemplate,
  templateNodeId: string,
  blockId: string,
): FluxeryBlockNodeMetadata => {
  const nodeTemplate = template.nodes.find((node) => node.id === templateNodeId);
  return {
    blockId,
    configLabels: Object.fromEntries(
      template.configFields
        .filter((field) => field.nodeId === templateNodeId)
        .map((field) => [field.key, field.label]),
    ),
    inputLabels: Object.fromEntries(
      template.inputs
        .filter((port) => port.nodeId === templateNodeId)
        .map((port) => [port.handle, port.label]),
    ),
    nodeLabel: nodeTemplate === undefined ? undefined : getDefaultNodeLabel(nodeTemplate),
    outputLabels: Object.fromEntries(
      template.outputs
        .filter((port) => port.nodeId === templateNodeId)
        .map((port) => [port.handle, port.label]),
    ),
    templateId: template.id,
    templateName: template.name,
  };
};

/**
 * Converts an existing multi-node selection into a block instance in-place by attaching block
 * metadata to the selected nodes and marking any touched edges with the new block id.
 */
export const createBlockFromSelection = ({
  blockId,
  edges,
  name,
  nodes,
  selectedNodeIds,
  template,
}: {
  blockId: string;
  edges: Edge[];
  name: string;
  nodes: Node[];
  selectedNodeIds: string[];
  template: FluxeryBlockTemplate;
}): { edges: Edge[]; nodes: Node[] } => {
  const selectedSet = new Set(selectedNodeIds);
  const nextNodes = nodes.map((node) => {
    if (!selectedSet.has(node.id)) {
      return {
        ...node,
        selected: false,
      };
    }
    return attachBlockMetadataToNode(
      {
        ...node,
        selected: true,
      },
      {
        ...getTemplateNodeMetadata(template, node.id, blockId),
        templateName: name,
      },
    );
  });

  const nextEdges = edges.map((edge) => {
    const involvedBlockIds = new Set(getBlockIdsFromEdgeData(edge));
    if (selectedSet.has(edge.source) || selectedSet.has(edge.target)) {
      involvedBlockIds.add(blockId);
    }
    return setEdgeBlockIds(edge, Array.from(involvedBlockIds));
  });

  return {
    edges: nextEdges,
    nodes: nextNodes,
  };
};

/**
 * Instantiates a block template as a fresh block instance by assigning new ids, offsetting node
 * positions, and attaching block metadata to the cloned nodes and edges.
 */
export const instantiateBlockTemplate = ({
  blockId,
  position,
  template,
}: {
  blockId: string;
  position: { x: number; y: number };
  template: FluxeryBlockTemplate;
}): { edges: Edge[]; nodes: Node[] } => {
  const nodeIdMap = new Map<string, string>();
  for (const node of template.nodes) {
    nodeIdMap.set(node.id, crypto.randomUUID());
  }

  const nodes = template.nodes.map((node) => {
    const nextId = nodeIdMap.get(node.id);
    if (nextId === undefined) {
      throw new Error(`Missing mapped node id for template node ${node.id}`);
    }
    const metadata = getTemplateNodeMetadata(template, node.id, blockId);
    return attachBlockMetadataToNode(
      {
        ...node,
        id: nextId,
        selected: true,
        position: {
          x: position.x + node.position.x,
          y: position.y + node.position.y,
        },
      },
      metadata,
    );
  });

  const edges = template.edges.map((edge) => {
    const source = nodeIdMap.get(edge.source);
    const target = nodeIdMap.get(edge.target);
    if (source === undefined || target === undefined) {
      throw new Error(`Missing mapped edge node for template edge ${edge.id}`);
    }
    return setEdgeBlockIds(
      {
        ...edge,
        id: crypto.randomUUID(),
        selected: false,
        source,
        target,
      },
      [blockId],
    );
  });

  return {
    edges,
    nodes,
  };
};

/**
 * Converts a connection created against displayed block nodes back into the equivalent raw
 * node-to-node connection and returns the block ids it traverses.
 */
export const resolveRawConnectionFromDisplayed = (
  connection: Connection,
): {
  blockIds: string[];
  connection: Connection;
} | null => {
  const sourceBlockId = parseSyntheticBlockNodeId(connection.source);
  const targetBlockId = parseSyntheticBlockNodeId(connection.target);

  const sourceHandle = parseBlockHandleId(connection.sourceHandle);
  const targetHandle = parseBlockHandleId(connection.targetHandle);

  if (sourceBlockId !== null && sourceHandle?.direction !== 'output') {
    return null;
  }
  if (targetBlockId !== null && targetHandle?.direction !== 'input') {
    return null;
  }

  return {
    blockIds: Array.from(
      new Set([sourceBlockId, targetBlockId].filter((value): value is string => value !== null)),
    ),
    connection: {
      ...connection,
      source:
        sourceBlockId === null
          ? connection.source
          : (sourceHandle as NonNullable<typeof sourceHandle>).nodeId,
      sourceHandle:
        sourceBlockId === null
          ? connection.sourceHandle
          : (sourceHandle as NonNullable<typeof sourceHandle>).handle,
      target:
        targetBlockId === null
          ? connection.target
          : (targetHandle as NonNullable<typeof targetHandle>).nodeId,
      targetHandle:
        targetBlockId === null
          ? connection.targetHandle
          : (targetHandle as NonNullable<typeof targetHandle>).handle,
    },
  };
};

/**
 * Adds or merges block ids onto an edge so boundary edges can keep track of which block instances
 * they cross.
 */
export const withConnectionBlockMetadata = (edge: Edge, blockIds: string[]): Edge =>
  setEdgeBlockIds(edge, Array.from(new Set([...getBlockIdsFromEdgeData(edge), ...blockIds])));

/**
 * Safely reads the display-layer payload stored on a synthetic block node.
 */
export const getBlockDisplayData = (
  node: Pick<Node, 'type' | 'data'>,
): BlockNodeDisplayData | null => {
  if (!isBlockNode(node)) {
    return null;
  }
  const nodeData = node.data as Partial<BlockNodeDisplayData>;
  if (
    typeof nodeData.blockId !== 'string' ||
    typeof nodeData.title !== 'string' ||
    !Array.isArray(nodeData.inputs) ||
    !Array.isArray(nodeData.outputs) ||
    !Array.isArray(nodeData.configFields) ||
    !Array.isArray(nodeData.configuredTargetPortIds)
  ) {
    return null;
  }
  return nodeData as BlockNodeDisplayData;
};

/**
 * Updates the display label for one raw node inside a block instance.
 */
export const updateBlockNodeLabel = (
  nodes: Node[],
  blockId: string,
  nodeId: string,
  label: string,
): Node[] =>
  nodes.map((node) => {
    const metadata = getBlockMetadata(node);
    if (metadata?.blockId !== blockId || node.id !== nodeId) {
      return node;
    }
    return attachBlockMetadataToNode(
      {
        ...node,
        data: {
          ...node.data,
          title: label,
        },
      },
      {
        ...metadata,
        nodeLabel: label,
      },
    );
  });

/**
 * Updates the friendly label for one exposed input or output port inside a block instance.
 */
export const updateBlockPortLabel = (
  nodes: Node[],
  blockId: string,
  nodeId: string,
  direction: 'input' | 'output',
  handle: string,
  label: string,
): Node[] =>
  nodes.map((node) => {
    const metadata = getBlockMetadata(node);
    if (metadata?.blockId !== blockId || node.id !== nodeId) {
      return node;
    }
    const nextLabels =
      direction === 'input'
        ? { ...(metadata.inputLabels ?? {}), [handle]: label }
        : { ...(metadata.outputLabels ?? {}), [handle]: label };
    return attachBlockMetadataToNode(node, {
      ...metadata,
      inputLabels: direction === 'input' ? nextLabels : metadata.inputLabels,
      outputLabels: direction === 'output' ? nextLabels : metadata.outputLabels,
    });
  });

/**
 * Updates the friendly label for one exposed configuration field inside a block instance.
 */
export const updateBlockConfigFieldLabel = (
  nodes: Node[],
  blockId: string,
  nodeId: string,
  key: string,
  label: string,
): Node[] =>
  nodes.map((node) => {
    const metadata = getBlockMetadata(node);
    if (metadata?.blockId !== blockId || node.id !== nodeId) {
      return node;
    }
    return attachBlockMetadataToNode(node, {
      ...metadata,
      configLabels: {
        ...(metadata.configLabels ?? {}),
        [key]: label,
      },
    });
  });

/**
 * Resolves the raw edge id for a displayed edge, falling back to the edge id itself when the edge
 * was never projected through the block display layer.
 */
export const getRawEdgeId = (edge: Edge): string => {
  const edgeData = edge.data as EdgeWithBlockData | undefined;
  return edgeData?.rawEdgeId ?? edge.id;
};
