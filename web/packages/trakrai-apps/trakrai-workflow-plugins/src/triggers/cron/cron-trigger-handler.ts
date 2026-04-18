import {
  EMPTY_OBJECT_SCHEMA,
  getNodeConfiguration,
  type NodeAddedCallbackArgs,
  type NodeExecutionArgs,
  type NodeRemovedCallbackArgs,
  WorkflowNodeHandler,
  type NodeConfigurationField,
  type NodeSchemaLike,
  type NodeUpdatedCallbackArgs,
} from '@trakrai-workflow/core';
import { getTRPCPluginAPIs } from '@trakrai-workflow/ui';
import { NonRetriableError } from 'inngest';

import type { CronTriggerPlugin } from './cron-trigger-api';

const TRIGGER_CATEGORY = 'trigger';

const getConfiguredCronExpression = (
  node: Parameters<typeof getNodeConfiguration>[0],
): string | undefined => {
  const { cronExpression } = getNodeConfiguration(node);
  return typeof cronExpression === 'string' && cronExpression.trim().length > 0
    ? cronExpression.trim()
    : undefined;
};

/**
 * Workflow entry-node handler for scheduler-driven runs.
 *
 * It mirrors the node's configured cron expression into the paired cron plugin so host apps can
 * provision or remove external schedules as the workflow changes.
 */
export class CronTriggerNodeHandler<
  Context extends { trigger: { type: string; id: string } },
> extends WorkflowNodeHandler<Context> {
  override getInputSchema(): NodeSchemaLike {
    return EMPTY_OBJECT_SCHEMA;
  }
  override getOutputSchema(): NodeSchemaLike {
    return EMPTY_OBJECT_SCHEMA;
  }

  override getConfigurationFields(): NodeConfigurationField[] {
    return [
      {
        key: 'cronExpression',
        label: 'Cron Schedule',
        description: 'Define the cron schedule for this trigger.',
        field: 'cronBuilder',
      },
    ];
  }

  override execute(args: NodeExecutionArgs<Context>) {
    const active =
      args.context.trigger.type === 'cron' && args.context.trigger.id === `cron:${args.node.id}`;
    if (!active) {
      throw new NonRetriableError('Trigger is not active');
    }
    return {};
  }

  override getDescription() {
    return 'Entry trigger for scheduler-based runs. Uses cronExpression to register periodic workflow runs.';
  }

  override getCategory() {
    return TRIGGER_CATEGORY;
  }

  override async onNodeAdded(args: NodeAddedCallbackArgs) {
    const cronExpression = getConfiguredCronExpression(args.node);
    if (cronExpression === undefined) {
      return;
    }
    await this.saveTrigger(args, cronExpression);
  }

  override async onNodeRemoved(args: NodeRemovedCallbackArgs) {
    const client = getTRPCPluginAPIs<CronTriggerPlugin>(args.trpc, 'cron-trigger');
    await args.queryClient
      .getMutationCache()
      .build(args.queryClient, client.deleteTrigger.mutationOptions())
      .execute({
        nodeId: args.node.id,
        extras: args.extras,
      });
  }

  override async onNodeUpdated(args: NodeUpdatedCallbackArgs) {
    const cronExpression = getConfiguredCronExpression(args.node);
    const previousCronExpression = getConfiguredCronExpression(args.previousNode);

    if (cronExpression === previousCronExpression) {
      return;
    }

    if (cronExpression === undefined) {
      await this.onNodeRemoved(args);
      return;
    }

    await this.saveTrigger(args, cronExpression);
  }

  private async saveTrigger(
    args: NodeAddedCallbackArgs | NodeUpdatedCallbackArgs,
    cronExpression: string,
  ) {
    const client = getTRPCPluginAPIs<CronTriggerPlugin>(args.trpc, 'cron-trigger');
    await args.queryClient
      .getMutationCache()
      .build(args.queryClient, client.saveTrigger.mutationOptions())
      .execute({
        nodeId: args.node.id,
        cronExpression,
        extras: args.extras,
      });
  }
}
