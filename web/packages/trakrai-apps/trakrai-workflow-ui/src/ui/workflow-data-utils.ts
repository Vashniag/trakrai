import type { Edge, Node, WorkflowData } from '@trakrai-workflow/core';

/**
 * Serializes the current graph state into a `WorkflowData` object.
 *
 * Strips React Flow internal properties and retains only the essential fields
 * (id, type, position, data, measured for nodes; source, target, handles, etc. for edges).
 *
 * @param nodes - The current array of workflow nodes.
 * @param edges - The current array of workflow edges.
 * @returns A serializable `WorkflowData` snapshot.
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
