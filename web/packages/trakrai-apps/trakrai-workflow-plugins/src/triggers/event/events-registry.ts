import { type EventTriggerDefinition, type EventTriggerDefinitions } from './event-trigger-handler';

import type { MaybePromise, JsonObject } from '@trakrai-workflow/core';
import type { z } from 'zod';

type EventTriggerTarget<ExecutionContext extends JsonObject> = {
  dedupeKey: string;
  nodeId: string;
  executionContext: ExecutionContext;
};

type EventTriggerWorkflowCallback<ExecutionContext extends JsonObject> = (
  input: ExecutionContext & {
    trigger: {
      type: string;
      id: string;
      eventName: string;
      data?: JsonObject | null;
    };
  },
) => Promise<string>;

const dedupeTargets = <ExecutionContext extends JsonObject>(
  targets: EventTriggerTarget<ExecutionContext>[],
): EventTriggerTarget<ExecutionContext>[] => {
  const seen = new Set<string>();
  const deduped: EventTriggerTarget<ExecutionContext>[] = [];

  for (const target of targets) {
    if (seen.has(target.dedupeKey)) {
      continue;
    }
    seen.add(target.dedupeKey);
    deduped.push(target);
  }

  return deduped;
};

/**
 * Builds a typed event dispatcher for app-defined workflow triggers.
 *
 * Each call to `sendEvent` validates payloads against the registered Zod schema, deduplicates
 * workflow targets returned by `getTargetsFromEventName`, and then fans out to `triggerWorkflow`.
 */
export const defineEventTriggerPlugin = <
  const TEvents extends Record<string, EventTriggerDefinition>,
  ExecutionContext extends JsonObject,
>({
  events,
  getTargetsFromEventName,
  triggerWorkflow,
}: {
  events: TEvents;
  getTargetsFromEventName: (
    eventName: Extract<keyof TEvents, string>,
  ) => MaybePromise<EventTriggerTarget<ExecutionContext>[]>;
  triggerWorkflow: EventTriggerWorkflowCallback<ExecutionContext>;
}) => {
  const sendEvent = async <TEventName extends Extract<keyof TEvents, string>>(
    eventName: TEventName,
    data: z.input<TEvents[TEventName]['dataSchema']>,
  ) => {
    const definition = events[eventName];
    if (definition === undefined) {
      throw new Error(`Event "${eventName}" is not registered`);
    }

    const parsedData = definition.dataSchema.safeParse(data);
    if (!parsedData.success) {
      throw new Error(parsedData.error.message);
    }

    const targets = dedupeTargets(await getTargetsFromEventName(eventName));
    const eventIds: string[] = [];

    for (const target of targets) {
      const eventId = await triggerWorkflow({
        ...target.executionContext,
        trigger: {
          data: parsedData.data as JsonObject,
          eventName,
          id: `event:${target.nodeId}`,
          type: 'event',
        },
      });
      eventIds.push(eventId);
    }

    return {
      dispatchedCount: eventIds.length,
      eventIds,
    };
  };

  return {
    sendEvent,
  };
};

export type { EventTriggerDefinitions };
