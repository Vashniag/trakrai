import {
  ExecutionSuccessHandle,
  TriggerHandle,
  type Edge,
  type Node,
} from '@trakrai-workflow/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { automation } from '../execution/workflowAutomation';

const LONG_HTML_REPEAT_COUNT = 400;

const createNode = (id: string, type: string): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { configuration: {} },
});

const createStatusTriggerEdge = (source: string, target: string, configuration: boolean): Edge => ({
  id: `${source}-${target}-${configuration.toString()}`,
  source,
  sourceHandle: ExecutionSuccessHandle,
  target,
  targetHandle: TriggerHandle,
  data: { configuration },
  type: 'conditionalEdge',
});

class FakeStep {
  private readonly sentEvents = new Map<string, Record<string, unknown>>();
  private readonly waiters = new Map<string, Array<(payload: Record<string, unknown>) => void>>();
  private eventCounter = 0;

  async run<T>(_id: string, callback: () => Promise<T> | T): Promise<T> {
    return callback();
  }

  async waitForEvent(
    _id: string,
    options: { event: string; timeout: string },
  ): Promise<Record<string, unknown>> {
    const existing = this.sentEvents.get(options.event);
    if (existing !== undefined) {
      return existing;
    }

    return new Promise<Record<string, unknown>>((resolve) => {
      const waiters = this.waiters.get(options.event) ?? [];
      waiters.push(resolve);
      this.waiters.set(options.event, waiters);
    });
  }

  async sendEvent(
    _id: string,
    payload: { name: string; data?: Record<string, unknown> },
  ): Promise<void> {
    const eventPayload = {
      id: `event-${this.eventCounter++}`,
      name: payload.name,
      data: payload.data ?? {},
      ts: Date.now(),
    };
    this.sentEvents.set(payload.name, eventPayload);

    const waiters = this.waiters.get(payload.name) ?? [];
    for (const waiter of waiters) {
      waiter(eventPayload);
    }
    this.waiters.delete(payload.name);
  }
}

describe('workflowAutomation execution success handle', () => {
  const nodeSchemas = {
    start: {
      input: z.object({}),
      output: z.object({}),
      category: 'test',
      description: 'Start node',
    },
    end: {
      input: z.object({}),
      output: z.object({ done: z.boolean() }),
      category: 'test',
      description: 'End node',
    },
  };

  const baseContext = {
    event: {
      id: 'event-1',
      ts: Date.now(),
      data: {},
    },
    logger: {
      info: () => {},
    },
    runId: 'run-1',
  };

  it('triggers downstream nodes on success even when the source node has no outputs', async () => {
    const result = await automation(
      {
        ...baseContext,
        step: new FakeStep(),
      } as never,
      nodeSchemas,
      {
        start: async () => ({}),
        end: async () => ({ done: true }),
      },
      () => ({}),
      async () => ({
        workflowChart: {
          nodes: [createNode('start', 'start'), createNode('end', 'end')],
          edges: [createStatusTriggerEdge('start', 'end', true)],
        },
      }),
    );

    expect(result.results.start).toMatchObject({ success: true });
    expect(result.results.end).toMatchObject({
      success: true,
      data: { done: true },
    });
  });

  it('triggers downstream nodes on failure when the edge condition is false', async () => {
    const result = await automation(
      {
        ...baseContext,
        step: new FakeStep(),
      } as never,
      nodeSchemas,
      {
        start: async () => {
          throw new Error('boom');
        },
        end: async () => ({ done: true }),
      },
      () => ({}),
      async () => ({
        workflowChart: {
          nodes: [createNode('start', 'start'), createNode('end', 'end')],
          edges: [createStatusTriggerEdge('start', 'end', false)],
        },
      }),
    );

    expect(result.results.start).toMatchObject({
      success: false,
      error: 'boom',
    });
    expect(result.results.end).toMatchObject({
      success: true,
      data: { done: true },
    });
  });

  it('sanitizes and truncates logged node payloads before writing them to the runtime logger', async () => {
    const logger = {
      info: vi.fn(),
    };
    const paddedHtml = `<div>Join Fluxery\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF ${'x'.repeat(LONG_HTML_REPEAT_COUNT)}</div>`;

    await automation(
      {
        ...baseContext,
        logger,
        step: new FakeStep(),
      } as never,
      {
        start: {
          input: z.object({}),
          output: z.object({
            html: z.string(),
            text: z.string(),
          }),
          category: 'test',
          description: 'Start node',
        },
      },
      {
        start: async () => ({
          html: paddedHtml,
          text: 'Hello world',
        }),
      },
      () => ({}),
      async () => ({
        workflowChart: {
          nodes: [createNode('start', 'start')],
          edges: [],
        },
      }),
    );

    const outputCall = logger.info.mock.calls.find(([message]) => {
      return String(message).includes('Node start completed successfully with output');
    });

    const loggedPayload = outputCall?.[1] as
      | {
          html?: string;
          text?: string;
        }
      | undefined;

    expect(loggedPayload).toBeDefined();
    expect(typeof loggedPayload?.html).toBe('string');
    expect(loggedPayload?.text).toBe('Hello world');

    const loggedOutputHtml = String(loggedPayload?.html);

    expect(loggedOutputHtml).toContain('Join Fluxery');
    expect(loggedOutputHtml).toContain('non-printable chars normalized');
    expect(loggedOutputHtml).toContain('chars');
    expect(loggedOutputHtml).not.toMatch(/[\u00A0\u200B-\u200F\u2060\uFEFF]/u);
  });
});
