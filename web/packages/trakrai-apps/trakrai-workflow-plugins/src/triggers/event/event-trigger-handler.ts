import {
  EMPTY_OBJECT_SCHEMA,
  getNodeConfiguration,
  type NodeAddedCallbackArgs,
  type NodeConfigurationField,
  type NodeExecutionArgs,
  type NodeRemovedCallbackArgs,
  type NodeSchemaLike,
  type NodeSchemaResolutionContext,
  type NodeUpdatedCallbackArgs,
  type JsonObject,
  WorkflowNodeHandler,
} from '@trakrai-workflow/core';
import { getTRPCPluginAPIs } from '@trakrai-workflow/ui';
import { NonRetriableError } from 'inngest';
import { z } from 'zod';

import { type EventOption } from './types';

import type { EventTriggerPlugin } from './event-trigger-plugin';

const TRIGGER_CATEGORY = 'trigger';

/**
 * Declares an application event that can be wired to workflow start nodes.
 */
export type EventTriggerDefinition<TSchema extends z.ZodObject = z.ZodObject> = {
  dataSchema: TSchema;
  description?: string;
  label?: string;
};

export type EventTriggerDefinitions = Record<string, EventTriggerDefinition>;

type ResolvedEventDefinition = {
  jsonSchema: z.core.JSONSchema._JSONSchema;
};

const getConfiguredEventName = (nodeConfiguration: Record<string, unknown>): string | undefined => {
  const { eventName } = nodeConfiguration;
  return typeof eventName === 'string' && eventName.length > 0 ? eventName : undefined;
};

const matchesEventTriggerNode = (triggerId: string, nodeId: string): boolean => {
  return triggerId === `event:${nodeId}` || triggerId.endsWith(`:${nodeId}`);
};

/**
 * Workflow entry-node handler for application events registered through
 * {@link defineEventTriggerPlugin}.
 *
 * The selected event determines the node's output schema and is synchronized to the paired
 * `event-trigger` persistence plugin on add, update, and removal.
 */
export class EventTriggerNodeHandler<
  Context extends {
    trigger: {
      type: string;
      id: string;
      eventName: string;
      data?: JsonObject | null;
    };
  },
> extends WorkflowNodeHandler<Context> {
  private readonly eventOptions: EventOption[];
  private readonly eventsByName: Map<string, ResolvedEventDefinition>;

  constructor(events: EventTriggerDefinitions) {
    super();
    this.eventOptions = Object.entries(events).map(([eventName, definition]) => ({
      dataSchema: z.toJSONSchema(definition.dataSchema) as z.core.JSONSchema._JSONSchema,
      description: definition.description,
      label: definition.label,
      value: eventName,
    }));
    this.eventsByName = new Map(
      this.eventOptions.map((option) => [
        option.value,
        {
          jsonSchema: option.dataSchema,
        },
      ]),
    );
  }

  override getInputSchema(): NodeSchemaLike {
    return EMPTY_OBJECT_SCHEMA;
  }

  override getOutputSchema(context: NodeSchemaResolutionContext): NodeSchemaLike {
    const configuration = getNodeConfiguration(context.node);
    const eventName = getConfiguredEventName(configuration);
    if (eventName === undefined) {
      return EMPTY_OBJECT_SCHEMA;
    }

    return this.eventsByName.get(eventName)?.jsonSchema ?? EMPTY_OBJECT_SCHEMA;
  }

  override getConfigurationFields(): NodeConfigurationField[] {
    return [
      {
        key: 'eventName',
        label: 'Event',
        description: 'Select the app event that should start this workflow.',
        field: 'eventTriggerSelector',
        fieldConfig: {
          defaultValue: this.eventOptions[0]?.value ?? '',
          eventOptions: this.eventOptions,
        },
      },
    ];
  }

  override execute(args: NodeExecutionArgs<Context>) {
    const configuration = getNodeConfiguration(args.node);
    const eventName = getConfiguredEventName(configuration);
    if (eventName === undefined) {
      throw new NonRetriableError('Event trigger is not configured');
    }
    if (!this.eventsByName.has(eventName)) {
      throw new NonRetriableError(`Configured event "${eventName}" is not registered`);
    }

    const active =
      args.context.trigger.type === 'event' &&
      matchesEventTriggerNode(args.context.trigger.id, args.node.id) &&
      args.context.trigger.eventName === eventName;

    if (!active) {
      throw new NonRetriableError('Trigger is not active');
    }

    return args.context.trigger.data ?? {};
  }

  override getDescription() {
    return 'Entry trigger for app-wide events. Select an event and the node output will match its payload schema.';
  }

  override getCategory() {
    return TRIGGER_CATEGORY;
  }

  override async onNodeAdded(args: NodeAddedCallbackArgs) {
    const eventName = this.getPersistedEventName(args.node);
    if (eventName === undefined) {
      return;
    }
    await this.saveTrigger(args, eventName);
  }

  override async onNodeRemoved(args: NodeRemovedCallbackArgs) {
    const client = getTRPCPluginAPIs<EventTriggerPlugin>(args.trpc, 'event-trigger');
    await args.queryClient
      .getMutationCache()
      .build(args.queryClient, client.deleteTrigger.mutationOptions())
      .execute({
        nodeId: args.node.id,
        extras: args.extras,
      });
  }

  override async onNodeUpdated(args: NodeUpdatedCallbackArgs) {
    const eventName = this.getPersistedEventName(args.node);
    const previousEventName = this.getPersistedEventName(args.previousNode);

    if (eventName === previousEventName) {
      return;
    }

    if (eventName === undefined) {
      await this.onNodeRemoved(args);
      return;
    }

    await this.saveTrigger(args, eventName);
  }

  private getPersistedEventName(
    node: Parameters<typeof getNodeConfiguration>[0],
  ): string | undefined {
    const eventName = getConfiguredEventName(getNodeConfiguration(node));
    if (eventName === undefined || !this.eventsByName.has(eventName)) {
      return undefined;
    }
    return eventName;
  }

  private async saveTrigger(
    args: NodeAddedCallbackArgs | NodeUpdatedCallbackArgs,
    eventName: string,
  ) {
    const client = getTRPCPluginAPIs<EventTriggerPlugin>(args.trpc, 'event-trigger');
    await args.queryClient
      .getMutationCache()
      .build(args.queryClient, client.saveTrigger.mutationOptions())
      .execute({
        nodeId: args.node.id,
        eventName,
        extras: args.extras,
      });
  }
}
