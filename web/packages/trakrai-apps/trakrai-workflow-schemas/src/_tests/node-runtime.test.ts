import {
  BasicInputOutputNodeHandler,
  WorkflowNodeHandler,
  createNodeRuntime,
  type Node,
} from '@trakrai-workflow/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { SpreadObjectNodeHandler } from '../nodes/spread-object-node-handler';

const createNode = (
  id: string,
  type: string,
  configuration?: Record<string, unknown> | null,
): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { configuration: configuration ?? null },
});

describe('node-runtime', () => {
  it('resolves dynamic output schema through custom node handlers', () => {
    const nodes = [createNode('source', 'source'), createNode('spread', 'spread')];
    const edges = [
      {
        id: 'e-source-spread',
        source: 'source',
        sourceHandle: 'payload',
        target: 'spread',
        targetHandle: 'object',
      },
    ];

    const nodeRuntime = createNodeRuntime({
      nodes,
      edges,
      nodeSchemas: {
        source: {
          input: z.object({}),
          output: z.object({
            payload: z.object({
              foo: z.string(),
              count: z.number(),
            }),
          }),
          category: 'test',
          description: 'source',
        },
      },
      nodeHandlers: {
        spread: new SpreadObjectNodeHandler(),
      },
    });

    const spreadSchema = nodeRuntime.resolveNodeSchemaById('spread');
    expect(spreadSchema).toBeDefined();
    expect(spreadSchema?.output.properties.foo).toBeDefined();
    expect(spreadSchema?.output.properties.count).toBeDefined();
  });

  it('supports node types registered only through handlers', () => {
    class HandlerOnlyNode<Context extends object = object> extends WorkflowNodeHandler<Context> {
      override getInputSchema(
        _context: Parameters<WorkflowNodeHandler<Context>['getInputSchema']>[0],
      ) {
        return {
          type: 'object' as const,
          properties: { value: { type: 'number' as const } },
          required: ['value'],
          additionalProperties: false,
        };
      }

      override getOutputSchema(
        _context: Parameters<WorkflowNodeHandler<Context>['getOutputSchema']>[0],
      ) {
        return {
          type: 'object' as const,
          properties: { doubled: { type: 'number' as const } },
          required: ['doubled'],
          additionalProperties: false,
        };
      }

      override getCategory() {
        return 'custom';
      }

      override getDescription() {
        return 'handler only';
      }
    }

    const runtime = createNodeRuntime({
      nodes: [createNode('h1', 'handlerOnly')],
      edges: [],
      nodeSchemas: {},
      nodeHandlers: {
        handlerOnly: new HandlerOnlyNode(),
      },
    });

    const schema = runtime.resolveNodeSchemaById('h1');
    expect(schema).toBeDefined();
    expect(schema?.category).toBe('custom');
    expect(schema?.input.properties.value).toBeDefined();
    expect(schema?.output.properties.doubled).toBeDefined();
  });

  it('validates input and output in basic node handler execution', async () => {
    const handler = new BasicInputOutputNodeHandler(
      {
        input: z.object({ value: z.number() }),
        output: z.object({ result: z.number() }),
        category: 'test',
        description: 'basic',
      },
      async () => ({ result: 'wrong-type' }),
    );

    await expect(
      handler.execute({
        node: createNode('n1', 'basic'),
        input: { value: 12 },
        context: {},
        logger: {
          info: () => {},
        } as never,
        events: {},
      }),
    ).rejects.toThrow('Invalid output');
  });
});
