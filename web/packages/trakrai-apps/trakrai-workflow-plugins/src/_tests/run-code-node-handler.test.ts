import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Node } from '@trakrai-workflow/core';

import { RunCodeNodeHandler } from '../code-runner/run-code-node-handler';

const createNode = (configuration: Record<string, unknown>): Node => ({
  id: 'run-code-node',
  type: 'runCode',
  position: { x: 0, y: 0 },
  data: { configuration },
});

describe('RunCodeNodeHandler', () => {
  it('executes legacy body-style code', async () => {
    const handler = new RunCodeNodeHandler();
    const inputSchema = z.toJSONSchema(z.object({ value: z.number() }));
    const outputSchema = z.toJSONSchema(z.object({ result: z.number() }));

    const result = await handler.execute({
      node: createNode({
        inputSchema,
        outputSchema,
        code: 'return { result: input.value * 2 };',
      }),
      input: { value: 5 },
      context: {},
      logger: { info: () => {} } as never,
      events: {},
    });

    expect(result).toEqual({ result: 10 });
  });

  it('executes full function code', async () => {
    const handler = new RunCodeNodeHandler();
    const inputSchema = z.toJSONSchema(z.object({ value: z.number() }));
    const outputSchema = z.toJSONSchema(z.object({ result: z.number() }));

    const result = await handler.execute({
      node: createNode({
        inputSchema,
        outputSchema,
        code: '(input) => ({ result: input.value * 3 })',
      }),
      input: { value: 5 },
      context: {},
      logger: { info: () => {} } as never,
      events: {},
    });

    expect(result).toEqual({ result: 15 });
  });
});
