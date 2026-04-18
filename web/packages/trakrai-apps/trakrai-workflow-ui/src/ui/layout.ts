import dagre, { type EdgeLabel, type GraphLabel, type NodeLabel } from '@dagrejs/dagre';
import {
  type NodeRuntime,
  type Node,
  type Edge,
  ExecutionSuccessHandle,
  TriggerHandle,
  buildNodeEventId,
} from '@trakrai-workflow/core';
import { Position } from '@xyflow/react';

import type { ELK as ElkInstance } from 'elkjs/lib/elk-api';

const DEFAULT_NODE_WIDTH = 172;
const DEFAULT_NODE_HEIGHT = 36;

/** Direction for automatic workflow layout. */
export type LayoutDirection = 'RIGHT' | 'DOWN';

/** Result of a layout operation containing repositioned nodes. */
export type LayoutResult = { nodes: Node[] };

/** Interface for pluggable workflow layout algorithms. */
export interface LayoutEngine {
  layout: (nodes: Node[], edges: Edge[], direction?: LayoutDirection) => Promise<LayoutResult>;
}

interface DagreOptions {
  /** Space between nodes on the same rank (default 100) */
  nodesep?: number;
  /** Space between ranks (default 180) */
  ranksep?: number;
}

const createDagreLayout = (options: DagreOptions = {}): LayoutEngine => {
  const { nodesep = 100, ranksep = 180 } = options;

  return {
    layout: (nodes, edges, direction: LayoutDirection = 'RIGHT') => {
      const rankdir = direction === 'RIGHT' ? 'LR' : 'TB';
      const isHorizontal = direction === 'RIGHT';

      const dagreGraph = new dagre.graphlib.Graph<
        GraphLabel,
        NodeLabel,
        EdgeLabel
      >().setDefaultEdgeLabel(() => ({}));
      dagreGraph.setGraph({ rankdir, nodesep, ranksep });

      nodes.forEach((node) => {
        const width = node.measured?.width ?? DEFAULT_NODE_WIDTH;
        const height = node.measured?.height ?? DEFAULT_NODE_HEIGHT;
        dagreGraph.setNode(node.id, { width, height });
      });

      edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
      });

      dagre.layout(dagreGraph);

      const layoutedNodes = nodes.map((node) => {
        const pos = dagreGraph.node(node.id) as { x: number; y: number };
        const width = node.measured?.width ?? DEFAULT_NODE_WIDTH;
        const height = node.measured?.height ?? DEFAULT_NODE_HEIGHT;
        return {
          ...node,
          targetPosition: isHorizontal ? Position.Left : Position.Top,
          sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
          position: {
            x: pos.x - width / 2,
            y: pos.y - height / 2,
          },
        };
      });

      return Promise.resolve({ nodes: layoutedNodes });
    },
  };
};

interface ElkOptions<Context extends object> {
  /** ELK algorithm (default "layered") */
  algorithm?: string;
  /** Space between nodes on the same layer (default 80) */
  nodeNodeSpacing?: string;
  /** Space between layers (default 100) */
  layerSpacing?: string;
  /** Spacing between edges and nodes within layers (default 40) */
  edgeNodeBetweenLayersSpacing?: string;
  /** Node placement strategy (default "SIMPLE") */
  nodePlacementStrategy?: string;

  nodeRuntime: NodeRuntime<Context>;
}

const createElkLayout = <Context extends object>(options: ElkOptions<Context>): LayoutEngine => {
  const {
    algorithm = 'layered',
    nodeNodeSpacing = '100',
    layerSpacing = '150',
    nodePlacementStrategy = 'SIMPLE',
    nodeRuntime,
  } = options;

  let elkInstance: ElkInstance | null = null;

  const getElk = async (): Promise<ElkInstance> => {
    if (elkInstance !== null) return elkInstance;
    const ELK = (await import('elkjs/lib/elk.bundled')).default;
    elkInstance = new ELK();
    return elkInstance;
  };

  return {
    layout: async (nodes, edges, direction: LayoutDirection = 'RIGHT') => {
      const elk = await getElk();
      const isHorizontal = direction === 'RIGHT';

      const getSchemaHandles = (
        node: Node,
      ): { targetHandles: string[]; sourceHandles: string[] } | null => {
        const schema = nodeRuntime.resolveNodeSchema(node);
        if (schema === undefined) {
          return null;
        }
        const targetHandles: string[] = [TriggerHandle, ...Object.keys(schema.input.properties)];
        const sourceHandles: string[] = [
          ...Object.keys(schema.output.properties),
          ExecutionSuccessHandle,
        ];

        if (schema.events !== undefined) {
          for (const [eventName, eventSchema] of Object.entries(schema.events)) {
            for (const propName of Object.keys(eventSchema.data.properties)) {
              sourceHandles.push(buildNodeEventId(eventName, propName));
            }
          }
        }
        return { targetHandles, sourceHandles };
      };

      const sourceSide = isHorizontal ? 'EAST' : 'SOUTH';
      const targetSide = isHorizontal ? 'WEST' : 'NORTH';

      // Namespace a handle ID with its owning node so that identically-named
      // handles on different nodes (e.g. "timestamp") don't collide in ELK.
      const PORT_SEP = ':::';
      const portId = (nodeId: string, handleId: string) => `${nodeId}${PORT_SEP}${handleId}`;

      // Build per-node port lists from edges so ELK knows about handle
      // positions and can route edges without collisions.
      const nodeTargetPorts = new Map<string, Set<string>>();
      const nodeSourcePorts = new Map<string, Set<string>>();

      for (const edge of edges) {
        const srcHandle = edge.sourceHandle ?? edge.source;
        const tgtHandle = edge.targetHandle ?? edge.target;

        const srcSet = nodeSourcePorts.get(edge.source) ?? new Set<string>();
        srcSet.add(srcHandle);
        nodeSourcePorts.set(edge.source, srcSet);

        const tgtSet = nodeTargetPorts.get(edge.target) ?? new Set<string>();
        tgtSet.add(tgtHandle);
        nodeTargetPorts.set(edge.target, tgtSet);
      }

      const graph = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': algorithm,
          'elk.direction': direction,
          'elk.layered.spacing.nodeNodeBetweenLayers': layerSpacing,
          'elk.spacing.nodeNode': nodeNodeSpacing,
          'elk.layered.nodePlacement.strategy': nodePlacementStrategy,
        },
        children: nodes.map((node) => {
          const schemaHandles = getSchemaHandles(node);

          let targetPorts: { id: string; properties: Record<string, string> }[];
          let sourcePorts: { id: string; properties: Record<string, string> }[];

          if (schemaHandles !== null) {
            targetPorts = schemaHandles.targetHandles.map((handle) => ({
              id: portId(node.id, handle),
              properties: { 'org.eclipse.elk.port.side': targetSide },
            }));
            sourcePorts = schemaHandles.sourceHandles.map((handle) => ({
              id: portId(node.id, handle),
              properties: { 'org.eclipse.elk.port.side': sourceSide },
            }));
          } else {
            targetPorts = [...(nodeTargetPorts.get(node.id) ?? [])].map((handle) => ({
              id: portId(node.id, handle),
              properties: { 'org.eclipse.elk.port.side': targetSide },
            }));
            sourcePorts = [...(nodeSourcePorts.get(node.id) ?? [])].map((handle) => ({
              id: portId(node.id, handle),
              properties: { 'org.eclipse.elk.port.side': sourceSide },
            }));
          }

          return {
            id: node.id,
            width: node.measured?.width ?? DEFAULT_NODE_WIDTH,
            height: node.measured?.height ?? DEFAULT_NODE_HEIGHT,
            properties: {
              'org.eclipse.elk.portConstraints': 'FIXED_ORDER',
            },
            // Include a fallback port namespaced with the node id for edges without handles.
            ports: [{ id: portId(node.id, node.id) }, ...targetPorts, ...sourcePorts],
          };
        }),
        edges: edges.map((edge) => ({
          id: edge.id,
          sources: [portId(edge.source, edge.sourceHandle ?? edge.source)],
          targets: [portId(edge.target, edge.targetHandle ?? edge.target)],
        })),
      };
      const layoutedGraph = await elk.layout(graph);

      const positionMap = new Map<string, { x: number; y: number }>();
      for (const child of layoutedGraph.children ?? []) {
        positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
      }

      const layoutedNodes = nodes.map((node) => {
        const pos = positionMap.get(node.id) ?? { x: 0, y: 0 };
        return {
          ...node,
          targetPosition: isHorizontal ? Position.Left : Position.Top,
          sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
          position: pos,
        };
      });

      return { nodes: layoutedNodes };
    },
  };
};

/**
 * Factory function to create a layout engine by name.
 *
 * @typeParam Context - Application-specific context type (required for ELK).
 * @param name - The layout algorithm to use: `'dagre'` for simpler graphs, `'elk'` for port-aware routing.
 * @param options - Algorithm-specific options. See `DagreOptions` or `ElkOptions`.
 * @returns A `LayoutEngine` instance.
 *
 * @example
 * ```ts
 * const engine = getLayoutEngine('dagre', { nodesep: 120 });
 * const { nodes } = await engine.layout(currentNodes, currentEdges);
 * ```
 */
export const getLayoutEngine = <Context extends object>(
  name: 'dagre' | 'elk',
  options?: DagreOptions | ElkOptions<Context>,
): LayoutEngine => {
  switch (name) {
    case 'dagre':
      return createDagreLayout(options as DagreOptions);
    case 'elk':
      return createElkLayout(options as ElkOptions<Context>);
  }
};
