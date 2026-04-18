import { type QueryClient } from '@tanstack/react-query';
import {
  type TRPCClient,
  WorkflowNodeHandler,
  type JsonObject,
  type Node,
  type NodeAddedCallbackArgs,
  type NodeRemovedCallbackArgs,
  type NodeUpdatedCallbackArgs,
  type WorkflowData,
} from '@trakrai-workflow/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { dispatchNodeMutationCallbacks, getNodeMutations } from '../../ui/node-mutation-utils';

type TestPluginContext = {
  baseUrl: string;
  endpoint: string;
};

const MANUAL_TRIGGER = 'trigger-manual';
const EVENT_TRIGGER = 'trigger-event';
const CRON_TRIGGER = 'trigger-cron';
const HTTP_TRIGGER = 'trigger-http';
const REMOVED_NODE_ID = 'node-removed';
const UPDATED_NODE_ID = 'node-updated';
const RETYPED_NODE_ID = 'node-retyped';
const ADDED_NODE_ID = 'node-added';
const USER_CREATED_EVENT = 'user.created';
const USER_UPDATED_EVENT = 'user.updated';
const HOURLY_CRON = '0 * * * *';

class TestNodeHandler extends WorkflowNodeHandler<object> {
  readonly added = vi.fn();
  readonly removed = vi.fn();
  readonly updated = vi.fn();

  override getInputSchema() {
    return z.object({});
  }

  override getOutputSchema() {
    return z.object({});
  }

  override onNodeAdded<ExtraContext extends JsonObject = JsonObject>(
    args: NodeAddedCallbackArgs<ExtraContext>,
  ) {
    this.added(args);
  }

  override onNodeRemoved<ExtraContext extends JsonObject = JsonObject>(
    args: NodeRemovedCallbackArgs<ExtraContext>,
  ) {
    this.removed(args);
  }

  override onNodeUpdated<ExtraContext extends JsonObject = JsonObject>(
    args: NodeUpdatedCallbackArgs<ExtraContext>,
  ) {
    this.updated(args);
  }
}

const createNode = (
  id: string,
  type: string,
  configuration?: Record<string, unknown>,
  position = { x: 0, y: 0 },
): Node => ({
  id,
  type,
  position,
  data: configuration === undefined ? {} : { configuration },
});

const createWorkflowData = (nodes: Node[]): WorkflowData => ({
  nodes,
  edges: [],
});

describe('getNodeMutations', () => {
  it('detects added, removed, updated, and type-swapped nodes', () => {
    const previousWorkflowData = createWorkflowData([
      createNode(REMOVED_NODE_ID, MANUAL_TRIGGER),
      createNode(UPDATED_NODE_ID, EVENT_TRIGGER, { eventName: USER_CREATED_EVENT }),
      createNode(RETYPED_NODE_ID, CRON_TRIGGER, { cronExpression: HOURLY_CRON }),
    ]);
    const currentWorkflowData = createWorkflowData([
      createNode(UPDATED_NODE_ID, EVENT_TRIGGER, { eventName: USER_UPDATED_EVENT }),
      createNode(RETYPED_NODE_ID, HTTP_TRIGGER),
      createNode(ADDED_NODE_ID, MANUAL_TRIGGER),
    ]);

    expect(getNodeMutations(previousWorkflowData, currentWorkflowData)).toEqual([
      {
        type: 'removed',
        node: previousWorkflowData.nodes[0],
      },
      {
        type: 'removed',
        node: previousWorkflowData.nodes[2],
      },
      {
        type: 'updated',
        node: currentWorkflowData.nodes[0],
        previousNode: previousWorkflowData.nodes[1],
      },
      {
        type: 'added',
        node: currentWorkflowData.nodes[1],
      },
      {
        type: 'added',
        node: currentWorkflowData.nodes[2],
      },
    ]);
  });

  it('ignores position-only changes', () => {
    const previousWorkflowData = createWorkflowData([
      createNode(UPDATED_NODE_ID, EVENT_TRIGGER, { eventName: USER_CREATED_EVENT }),
    ]);
    const currentWorkflowData = createWorkflowData([
      createNode(
        UPDATED_NODE_ID,
        EVENT_TRIGGER,
        { eventName: USER_CREATED_EVENT },
        { x: 320, y: 80 },
      ),
    ]);

    expect(getNodeMutations(previousWorkflowData, currentWorkflowData)).toEqual([]);
  });
});

describe('dispatchNodeMutationCallbacks', () => {
  it('calls node handler lifecycle hooks with full mutation context', async () => {
    const removedHandler = new TestNodeHandler();
    const updatedHandler = new TestNodeHandler();
    const newTypeHandler = new TestNodeHandler();
    const addedHandler = new TestNodeHandler();
    const previousWorkflowData = createWorkflowData([
      createNode(REMOVED_NODE_ID, MANUAL_TRIGGER),
      createNode(UPDATED_NODE_ID, EVENT_TRIGGER, { eventName: USER_CREATED_EVENT }),
      createNode(RETYPED_NODE_ID, CRON_TRIGGER, { cronExpression: HOURLY_CRON }),
    ]);
    const currentWorkflowData = createWorkflowData([
      createNode(UPDATED_NODE_ID, EVENT_TRIGGER, { eventName: USER_UPDATED_EVENT }),
      createNode(RETYPED_NODE_ID, HTTP_TRIGGER),
      createNode(ADDED_NODE_ID, MANUAL_TRIGGER, { payloadSchema: { type: 'object' } }),
    ]);
    const extras = {};
    const pluginContext: TestPluginContext = {
      baseUrl: 'https://example.com',
      endpoint: '/api/plugins',
    };

    await dispatchNodeMutationCallbacks({
      currentWorkflowData,
      previousWorkflowData,
      nodeHandlers: {
        [MANUAL_TRIGGER]: addedHandler,
        [EVENT_TRIGGER]: updatedHandler,
        [CRON_TRIGGER]: removedHandler,
        [HTTP_TRIGGER]: newTypeHandler,
      },
      extras,
      pluginContext,
      queryClient: {} as QueryClient,
      trpc: {} as TRPCClient,
    });

    expect(removedHandler.removed).toHaveBeenCalledOnce();
    expect(removedHandler.removed).toHaveBeenCalledWith(
      expect.objectContaining({
        node: previousWorkflowData.nodes[2],
        currentWorkflowData,
        previousWorkflowData,
        extras,
        pluginContext,
      }),
    );

    expect(updatedHandler.updated).toHaveBeenCalledOnce();
    expect(updatedHandler.updated).toHaveBeenCalledWith(
      expect.objectContaining({
        node: currentWorkflowData.nodes[0],
        previousNode: previousWorkflowData.nodes[1],
        currentWorkflowData,
        previousWorkflowData,
        extras,
        pluginContext,
      }),
    );

    expect(newTypeHandler.added).toHaveBeenCalledOnce();
    expect(newTypeHandler.added).toHaveBeenCalledWith(
      expect.objectContaining({
        node: currentWorkflowData.nodes[1],
        currentWorkflowData,
        previousWorkflowData,
        extras,
        pluginContext,
      }),
    );

    expect(addedHandler.removed).toHaveBeenCalledOnce();
    expect(addedHandler.added).toHaveBeenCalledOnce();
    expect(addedHandler.removed).toHaveBeenCalledWith(
      expect.objectContaining({
        node: previousWorkflowData.nodes[0],
        currentWorkflowData,
        previousWorkflowData,
        extras,
        pluginContext,
      }),
    );
    expect(addedHandler.added).toHaveBeenCalledWith(
      expect.objectContaining({
        node: currentWorkflowData.nodes[2],
        currentWorkflowData,
        previousWorkflowData,
        extras,
        pluginContext,
      }),
    );
  });

  it('does not call update hooks for position-only changes', async () => {
    const updatedHandler = new TestNodeHandler();
    const previousWorkflowData = createWorkflowData([
      createNode(UPDATED_NODE_ID, EVENT_TRIGGER, { eventName: USER_CREATED_EVENT }),
    ]);
    const currentWorkflowData = createWorkflowData([
      createNode(
        UPDATED_NODE_ID,
        EVENT_TRIGGER,
        { eventName: USER_CREATED_EVENT },
        { x: 200, y: 120 },
      ),
    ]);

    await dispatchNodeMutationCallbacks({
      currentWorkflowData,
      previousWorkflowData,
      nodeHandlers: {
        [EVENT_TRIGGER]: updatedHandler,
      },
      extras: {},
      pluginContext: {
        baseUrl: 'https://example.com',
        endpoint: '/api/plugins',
      },
      queryClient: {} as QueryClient,
      trpc: {} as TRPCClient,
    });

    expect(updatedHandler.updated).not.toHaveBeenCalled();
  });
});
