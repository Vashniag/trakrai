import {
  EMPTY_OBJECT_SCHEMA,
  getSchemaFromConfiguration,
  type NodeAddedCallbackArgs,
  type NodeExecutionArgs,
  type NodeRemovedCallbackArgs,
  WorkflowNodeHandler,
  type NodeConfigurationField,
  type NodeSchemaLike,
  type NodeSchemaResolutionContext,
  type NodeUpdatedCallbackArgs,
  type JsonObject,
} from '@trakrai-workflow/core';
import { getTRPCPluginAPIs } from '@trakrai-workflow/ui';
import { NonRetriableError } from 'inngest';

import type { ManualTriggerPlugin } from './manual-trigger-api';
import type { z } from 'zod';

const TRIGGER_CATEGORY = 'trigger';
const MANUAL_TRIGGER_PLUGIN_NAME = 'manual-trigger';
const PAYLOAD_SCHEMA_KEY = 'payloadSchema';

/**
 * Workflow entry-node handler for user-initiated manual runs.
 *
 * It persists the node's payload schema through the paired `manual-trigger` plugin so host apps can
 * validate ad-hoc run payloads before dispatching them back into the workflow runtime.
 */
export class ManualTriggerNodeHandler<
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
      args.context.trigger.type === 'manual' &&
      args.context.trigger.id === `manual:${args.node.id}`;
    if (!active) {
      throw new NonRetriableError('Trigger is not active');
    }
    return args.context.trigger.data ?? {};
  }

  override getDescription() {
    return 'Entry trigger for manual runs. Emits trigger metadata and payload when the workflow is run manually.';
  }

  override getCategory() {
    return TRIGGER_CATEGORY;
  }

  override async onNodeAdded(args: NodeAddedCallbackArgs) {
    await this.saveTrigger(args);
    await this.invalidateTriggerList(args);
  }

  override async onNodeRemoved(args: NodeRemovedCallbackArgs) {
    const client = getTRPCPluginAPIs<ManualTriggerPlugin>(args.trpc, MANUAL_TRIGGER_PLUGIN_NAME);
    await args.queryClient
      .getMutationCache()
      .build(args.queryClient, client.deleteTrigger.mutationOptions())
      .execute({
        nodeId: args.node.id,
        extras: args.extras,
      });
    await this.invalidateTriggerList(args);
  }

  override async onNodeUpdated(args: NodeUpdatedCallbackArgs) {
    const payloadSchema = getSchemaFromConfiguration(args.node, PAYLOAD_SCHEMA_KEY) ?? null;
    const previousPayloadSchema =
      getSchemaFromConfiguration(args.previousNode, PAYLOAD_SCHEMA_KEY) ?? null;

    if (JSON.stringify(payloadSchema) === JSON.stringify(previousPayloadSchema)) {
      return;
    }

    await this.saveTrigger(args);
    await this.invalidateTriggerList(args);
  }

  private async saveTrigger(args: NodeAddedCallbackArgs | NodeUpdatedCallbackArgs) {
    const client = getTRPCPluginAPIs<ManualTriggerPlugin>(args.trpc, MANUAL_TRIGGER_PLUGIN_NAME);
    await args.queryClient
      .getMutationCache()
      .build(args.queryClient, client.saveTrigger.mutationOptions())
      .execute({
        nodeId: args.node.id,
        payloadSchema: getSchemaFromConfiguration(args.node, PAYLOAD_SCHEMA_KEY) ?? null,
        extras: args.extras,
      });
  }

  private async invalidateTriggerList(
    args: NodeAddedCallbackArgs | NodeRemovedCallbackArgs | NodeUpdatedCallbackArgs,
  ) {
    const client = getTRPCPluginAPIs<ManualTriggerPlugin>(args.trpc, MANUAL_TRIGGER_PLUGIN_NAME);
    await args.queryClient.invalidateQueries({
      queryKey: client.listTriggers.queryOptions({
        context: args.extras as JsonObject,
      }).queryKey,
    });
  }
}
