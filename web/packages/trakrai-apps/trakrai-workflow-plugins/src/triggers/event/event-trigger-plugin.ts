import { defineTrpcPlugin, type ApiHooks, type JsonObject } from '@trakrai-workflow/core';
import { z } from 'zod';

type PluginCallbacks<ExtraContext extends JsonObject> = {
  saveTrigger: (input: {
    eventName: string;
    extras: ExtraContext;
    nodeId: string;
  }) => Promise<void>;
  deleteTrigger: (input: { extras: ExtraContext; nodeId: string }) => Promise<void>;
};

const eventTriggerTRPCPlugin = <ExtraContext extends JsonObject>(
  callbacks: PluginCallbacks<ExtraContext>,
  hooks?: ApiHooks,
) =>
  defineTrpcPlugin({
    name: 'event-trigger',
    hooks,
    createRouter: ({ router, procedure }) => {
      return router({
        saveTrigger: procedure
          .input(
            z.object({
              eventName: z.string(),
              nodeId: z.string().brand('nodeId'),
              extras: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .mutation(({ input }) => {
            const extras = input.extras as ExtraContext;
            return callbacks.saveTrigger({ ...input, extras });
          }),
        deleteTrigger: procedure
          .input(
            z.object({
              nodeId: z.string().brand('nodeId'),
              extras: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .mutation(({ input }) => {
            const extras = input.extras as ExtraContext;
            return callbacks.deleteTrigger({ ...input, extras });
          }),
      });
    },
  });

/**
 * Creates the tRPC plugin used by {@link EventTriggerNodeHandler} to persist which workflow node is
 * listening to which application event.
 */
export const eventTriggerPlugin = <ExtraContext extends JsonObject = JsonObject>(
  callbacks: PluginCallbacks<ExtraContext>,
  hooks?: ApiHooks,
) => eventTriggerTRPCPlugin(callbacks, hooks);

export type EventTriggerPlugin = ReturnType<typeof eventTriggerTRPCPlugin>;
