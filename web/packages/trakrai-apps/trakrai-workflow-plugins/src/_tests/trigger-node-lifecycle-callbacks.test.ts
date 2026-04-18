import { QueryClient } from '@tanstack/react-query';
import { getTRPCPluginAPIs } from '@trakrai-workflow/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Node, PluginClientConfig, TRPCClient, WorkflowData } from '@trakrai-workflow/core';

import { CronTriggerNodeHandler } from '../triggers/cron/cron-trigger-handler';
import { EventTriggerNodeHandler } from '../triggers/event/event-trigger-handler';
import { ManualTriggerNodeHandler } from '../triggers/manual/manual-trigger-handler';

vi.mock('@trakrai-workflow/ui', () => ({
  getTRPCPluginAPIs: vi.fn(),
}));

const WORKFLOW_DATA: WorkflowData = {
  nodes: [],
  edges: [],
};

const PLUGIN_CONTEXT: PluginClientConfig = {
  baseUrl: 'https://example.com',
  endpoint: '/api/plugins',
};

const TRIGGER_CONTEXT = {
  scopeId: 'scope-1',
};
const CRON_NODE_ID = 'cron-node';
const CRON_NODE_TYPE = 'trigger-cron';
const EVENT_NODE_ID = 'event-node';
const EVENT_NODE_TYPE = 'trigger-event';
const MANUAL_NODE_ID = 'manual-node';
const MANUAL_NODE_TYPE = 'trigger-manual';
const MANUAL_TRIGGER_QUERY_KEY = 'manual-trigger';

const createNode = (id: string, type: string, configuration?: Record<string, unknown>): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: configuration === undefined ? {} : { configuration },
});

const createMutationHandler = <TInput>(mutationFn: (input: TInput) => Promise<unknown>) => ({
  mutationOptions: () => ({
    mutationFn,
  }),
});

const createCallbackContext = () => ({
  currentWorkflowData: WORKFLOW_DATA,
  previousWorkflowData: WORKFLOW_DATA,
  extras: {
    ...TRIGGER_CONTEXT,
  },
  pluginContext: PLUGIN_CONTEXT,
  queryClient: new QueryClient(),
  trpc: {} as TRPCClient,
});

describe('trigger node lifecycle callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves cron triggers when a cron expression is configured', async () => {
    const saveTrigger = vi.fn(async () => undefined);
    const deleteTrigger = vi.fn(async () => undefined);
    vi.mocked(getTRPCPluginAPIs).mockReturnValue({
      saveTrigger: createMutationHandler(saveTrigger),
      deleteTrigger: createMutationHandler(deleteTrigger),
    } as never);

    const handler = new CronTriggerNodeHandler();

    await handler.onNodeAdded({
      ...createCallbackContext(),
      node: createNode(CRON_NODE_ID, CRON_NODE_TYPE, {
        cronExpression: '0 * * * *',
      }),
    });

    expect(saveTrigger).toHaveBeenCalledOnce();
    expect(saveTrigger).toHaveBeenNthCalledWith(
      1,
      {
        nodeId: CRON_NODE_ID,
        cronExpression: '0 * * * *',
        extras: {
          ...TRIGGER_CONTEXT,
        },
      },
      expect.anything(),
    );
    expect(deleteTrigger).not.toHaveBeenCalled();
  });

  it('deletes cron triggers when the cron expression is cleared', async () => {
    const saveTrigger = vi.fn(async () => undefined);
    const deleteTrigger = vi.fn(async () => undefined);
    vi.mocked(getTRPCPluginAPIs).mockReturnValue({
      saveTrigger: createMutationHandler(saveTrigger),
      deleteTrigger: createMutationHandler(deleteTrigger),
    } as never);

    const handler = new CronTriggerNodeHandler();

    await handler.onNodeUpdated({
      ...createCallbackContext(),
      node: createNode(CRON_NODE_ID, CRON_NODE_TYPE, {
        cronExpression: '   ',
      }),
      previousNode: createNode(CRON_NODE_ID, CRON_NODE_TYPE, {
        cronExpression: '0 * * * *',
      }),
    });

    expect(deleteTrigger).toHaveBeenCalledOnce();
    expect(deleteTrigger).toHaveBeenNthCalledWith(
      1,
      {
        nodeId: CRON_NODE_ID,
        extras: {
          ...TRIGGER_CONTEXT,
        },
      },
      expect.anything(),
    );
    expect(saveTrigger).not.toHaveBeenCalled();
  });

  it('saves event triggers when the configured event changes', async () => {
    const saveTrigger = vi.fn(async () => undefined);
    const deleteTrigger = vi.fn(async () => undefined);
    vi.mocked(getTRPCPluginAPIs).mockReturnValue({
      saveTrigger: createMutationHandler(saveTrigger),
      deleteTrigger: createMutationHandler(deleteTrigger),
    } as never);

    const handler = new EventTriggerNodeHandler({
      'user.created': {
        dataSchema: z.object({ id: z.string() }),
      },
      'user.updated': {
        dataSchema: z.object({ id: z.string() }),
      },
    });

    await handler.onNodeUpdated({
      ...createCallbackContext(),
      node: createNode(EVENT_NODE_ID, EVENT_NODE_TYPE, {
        eventName: 'user.updated',
      }),
      previousNode: createNode(EVENT_NODE_ID, EVENT_NODE_TYPE, {
        eventName: 'user.created',
      }),
    });

    expect(saveTrigger).toHaveBeenCalledOnce();
    expect(saveTrigger).toHaveBeenNthCalledWith(
      1,
      {
        nodeId: EVENT_NODE_ID,
        eventName: 'user.updated',
        extras: {
          ...TRIGGER_CONTEXT,
        },
      },
      expect.anything(),
    );
    expect(deleteTrigger).not.toHaveBeenCalled();
  });

  it('deletes event triggers when the node is removed', async () => {
    const saveTrigger = vi.fn(async () => undefined);
    const deleteTrigger = vi.fn(async () => undefined);
    vi.mocked(getTRPCPluginAPIs).mockReturnValue({
      saveTrigger: createMutationHandler(saveTrigger),
      deleteTrigger: createMutationHandler(deleteTrigger),
    } as never);

    const handler = new EventTriggerNodeHandler({
      'user.created': {
        dataSchema: z.object({ id: z.string() }),
      },
    });

    await handler.onNodeRemoved({
      ...createCallbackContext(),
      node: createNode(EVENT_NODE_ID, EVENT_NODE_TYPE, {
        eventName: 'user.created',
      }),
    });

    expect(deleteTrigger).toHaveBeenCalledOnce();
    expect(deleteTrigger).toHaveBeenNthCalledWith(
      1,
      {
        nodeId: EVENT_NODE_ID,
        extras: {
          ...TRIGGER_CONTEXT,
        },
      },
      expect.anything(),
    );
    expect(saveTrigger).not.toHaveBeenCalled();
  });

  it('saves manual triggers and invalidates the trigger list when payload schema changes', async () => {
    const saveTrigger = vi.fn(async () => undefined);
    const deleteTrigger = vi.fn(async () => undefined);
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(getTRPCPluginAPIs).mockReturnValue({
      listTriggers: {
        queryOptions: ({ context }: { context: typeof TRIGGER_CONTEXT }) => ({
          queryKey: [MANUAL_TRIGGER_QUERY_KEY, context],
        }),
      },
      saveTrigger: createMutationHandler(saveTrigger),
      deleteTrigger: createMutationHandler(deleteTrigger),
    } as never);

    const handler = new ManualTriggerNodeHandler();

    await handler.onNodeUpdated({
      ...createCallbackContext(),
      queryClient,
      node: createNode(MANUAL_NODE_ID, MANUAL_NODE_TYPE, {
        payloadSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
            },
          },
        },
      }),
      previousNode: createNode(MANUAL_NODE_ID, MANUAL_NODE_TYPE, {}),
    });

    expect(saveTrigger).toHaveBeenCalledOnce();
    expect(saveTrigger).toHaveBeenNthCalledWith(
      1,
      {
        nodeId: MANUAL_NODE_ID,
        payloadSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
            },
          },
        },
        extras: {
          ...TRIGGER_CONTEXT,
        },
      },
      expect.anything(),
    );
    expect(deleteTrigger).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [MANUAL_TRIGGER_QUERY_KEY, TRIGGER_CONTEXT],
    });
  });

  it('deletes manual triggers and invalidates the trigger list when the node is removed', async () => {
    const saveTrigger = vi.fn(async () => undefined);
    const deleteTrigger = vi.fn(async () => undefined);
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(getTRPCPluginAPIs).mockReturnValue({
      listTriggers: {
        queryOptions: ({ context }: { context: typeof TRIGGER_CONTEXT }) => ({
          queryKey: [MANUAL_TRIGGER_QUERY_KEY, context],
        }),
      },
      saveTrigger: createMutationHandler(saveTrigger),
      deleteTrigger: createMutationHandler(deleteTrigger),
    } as never);

    const handler = new ManualTriggerNodeHandler();

    await handler.onNodeRemoved({
      ...createCallbackContext(),
      queryClient,
      node: createNode(MANUAL_NODE_ID, MANUAL_NODE_TYPE, {
        payloadSchema: {
          type: 'object',
          properties: {},
        },
      }),
    });

    expect(deleteTrigger).toHaveBeenCalledOnce();
    expect(deleteTrigger).toHaveBeenNthCalledWith(
      1,
      {
        nodeId: MANUAL_NODE_ID,
        extras: {
          ...TRIGGER_CONTEXT,
        },
      },
      expect.anything(),
    );
    expect(saveTrigger).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [MANUAL_TRIGGER_QUERY_KEY, TRIGGER_CONTEXT],
    });
  });
});
