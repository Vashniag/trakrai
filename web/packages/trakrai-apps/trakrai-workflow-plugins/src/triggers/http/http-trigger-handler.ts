import {
  EMPTY_OBJECT_SCHEMA,
  getSchemaFromConfiguration,
  type NodeExecutionArgs,
  WorkflowNodeHandler,
  type NodeConfigurationField,
  type NodeSchemaLike,
  type NodeSchemaResolutionContext,
  type NodeRemovedCallbackArgs,
  type JsonObject,
} from '@trakrai-workflow/core';
import { getTRPCPluginAPIs } from '@trakrai-workflow/ui';
import { NonRetriableError } from 'inngest';

import { HttpTriggerNode } from './http-trigger-node';

import type { HttpTriggerPlugin } from './http-trigger-plugin';
import type { z } from 'zod';

const TRIGGER_CATEGORY = 'trigger';

/**
 * Workflow entry-node handler for token-authenticated HTTP/webhook runs.
 *
 * The paired `http-trigger` plugin manages secret tokens, while this handler only activates when
 * the runtime trigger context resolves to the current node id.
 */
export class HttpTriggerNodeHandler<
  Context extends { trigger: { type: string; id: string; data?: JsonObject | null } },
> extends WorkflowNodeHandler<Context> {
  override getInputSchema(): z.core.JSONSchema._JSONSchema {
    return EMPTY_OBJECT_SCHEMA;
  }
  override getOutputSchema(context: NodeSchemaResolutionContext): NodeSchemaLike | undefined {
    return getSchemaFromConfiguration(context.node, 'payloadSchema') ?? EMPTY_OBJECT_SCHEMA;
  }

  override getConfigurationFields(): NodeConfigurationField[] {
    return [
      {
        key: 'payloadSchema',
        label: 'Payload Schema',
        description: 'Define the schema for the trigger payload.',
        field: 'jsonSchemaBuilder',
      },
    ];
  }

  override execute(args: NodeExecutionArgs<Context>) {
    const active =
      args.context.trigger.type === 'http' && args.context.trigger.id === `http:${args.node.id}`;
    if (!active) {
      throw new NonRetriableError('Trigger is not active');
    }
    return args.context.trigger.data ?? {};
  }

  override getDescription() {
    return 'Entry trigger invoked via webhook endpoint using httpKey. Emits trigger metadata and request payload.';
  }

  override getRenderer() {
    return HttpTriggerNode;
  }

  override getCategory() {
    return TRIGGER_CATEGORY;
  }

  override async onNodeRemoved(args: NodeRemovedCallbackArgs) {
    const client = getTRPCPluginAPIs<HttpTriggerPlugin>(args.trpc, 'http-trigger');
    await args.queryClient
      .getMutationCache()
      .build(args.queryClient, client.deleteAllTokens.mutationOptions())
      .execute({
        nodeId: args.node.id,
        extras: args.extras,
      });
  }
}
