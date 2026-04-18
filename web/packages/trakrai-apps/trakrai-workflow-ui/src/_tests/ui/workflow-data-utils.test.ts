import { describe, expect, it } from 'vitest';

import type { Edge, Node } from '@trakrai-workflow/core';

import { serializeWorkflowData } from '../../ui/workflow-data-utils';

describe('serializeWorkflowData', () => {
  it('normalizes node and edge fields for persistence/export', () => {
    const nodes: Node[] = [
      {
        id: 'node-1',
        type: 'add',
        position: { x: 10, y: 20 },
        measured: { width: 100, height: 40 },
        data: { configuration: { a: 1 } },
      },
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'node-1',
        sourceHandle: 'result',
        target: 'node-2',
        targetHandle: 'a',
        animated: true,
        type: 'default',
      },
    ];

    expect(serializeWorkflowData(nodes, edges)).toEqual({
      nodes: [
        {
          id: 'node-1',
          type: 'add',
          position: { x: 10, y: 20 },
          measured: { width: 100, height: 40 },
          data: { configuration: { a: 1 } },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'node-1',
          sourceHandle: 'result',
          target: 'node-2',
          targetHandle: 'a',
          animated: true,
          type: 'default',
          data: undefined,
        },
      ],
    });
  });
});
