import type { Edge, Node, WorkflowData } from '@trakrai-workflow/core';

/**
 * Produces the portable workflow payload used by the JSON exporter and the PNG metadata exporter.
 *
 * Only editor-relevant node and edge fields are retained so the snapshot can be downloaded and later
 * re-imported without carrying runtime-only state.
 */
export const serializeWorkflowData = (nodes: Node[], edges: Edge[]): WorkflowData => {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
      measured: node.measured,
    })),
    edges: edges.map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      id: edge.id,
      data: edge.data,
      type: edge.type,
      animated: edge.animated,
    })),
  };
};
