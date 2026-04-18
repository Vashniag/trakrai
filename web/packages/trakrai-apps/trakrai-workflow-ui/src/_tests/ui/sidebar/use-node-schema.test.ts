import { createNodeRuntime, type Edge, type Node, type NodeSchemas } from '@trakrai-workflow/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { resolveNodeSchemaState } from '../../../ui/sidebar/use-node-schema';

const nodeSchemas: NodeSchemas = {
  constant: {
    input: z.object({ value: z.number() }),
    output: z.object({ value: z.number() }),
    category: 'Math',
    description: 'Constant value',
  },
  add: {
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    category: 'Math',
    description: 'Add numbers',
  },
};

describe('resolveNodeSchemaState', () => {
  it('derives edge/configuration based input groups for a selected node', () => {
    const nodes: Node[] = [
      {
        id: 'source-1',
        type: 'constant',
        position: { x: 0, y: 0 },
        data: { configuration: { value: 10 } },
      },
      {
        id: 'target-1',
        type: 'add',
        position: { x: 200, y: 0 },
        data: { configuration: { b: 20 } },
      },
    ];

    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'source-1',
        sourceHandle: 'value',
        target: 'target-1',
        targetHandle: 'a',
      },
    ];

    const nodeRuntime = createNodeRuntime({
      nodes,
      edges,
      nodeSchemas,
    });

    const state = resolveNodeSchemaState({
      selectedNode: 'target-1',
      nodeRuntime,
      nodes,
      edges,
    });

    expect(state.allInputs.map(([prop]) => prop)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(state.inputsViaEdges.map(([prop]) => prop)).toEqual(['a']);
    expect(state.inputsViaConfiguration.map(([prop]) => prop)).toEqual(['b']);
    expect(state.inputsAvailableForConfiguration).toHaveLength(0);
    expect(state.resolvedNodeSchema?.category).toBe('Math');
  });

  it('returns empty defaults when no node is selected', () => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeRuntime = createNodeRuntime({ nodes, edges, nodeSchemas });

    const state = resolveNodeSchemaState({
      selectedNode: null,
      nodeRuntime,
      nodes,
      edges,
    });

    expect(state.selectedNode).toBeNull();
    expect(state.allInputs).toHaveLength(0);
    expect(state.nodeEdges).toHaveLength(0);
    expect(state.resolvedNodeSchema).toBeUndefined();
  });
});
