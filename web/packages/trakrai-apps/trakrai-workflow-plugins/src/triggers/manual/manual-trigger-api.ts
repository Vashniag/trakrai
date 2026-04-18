import {
  defineHttpPlugin,
  defineTrpcPlugin,
  type ApiHooks,
  type JsonObject,
} from '@trakrai-workflow/core';
import { z } from 'zod';

const manualTriggerPayloadSchema = z.object({
  context: z.record(z.string(), z.unknown()),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  nodeId: z.string().optional(),
});

type ManualTriggerContext<TContext extends JsonObject> = TContext & {
  trigger: { type: string; id: string; data?: JsonObject | null };
};

type ManualTriggerDefinition = {
  nodeId: string;
  payloadSchema: z.core.JSONSchema._JSONSchema | null;
};

type PluginCallbacks<Context extends JsonObject, TriggerExtraContext extends JsonObject> = {
  contextSchema: z.ZodType<Context>;
  listTriggers: (input: { context: Context }) => Promise<ManualTriggerDefinition[]>;
  saveTrigger: (input: {
    extras: Context;
    nodeId: string;
    payloadSchema: z.core.JSONSchema._JSONSchema | null;
  }) => Promise<void>;
  deleteTrigger: (input: { extras: Context; nodeId: string }) => Promise<void>;
  triggerCallback: (
    workflowContext: ManualTriggerContext<Context> & TriggerExtraContext,
  ) => Promise<string>;
  preCheck: (input: {
    context: Context;
    data?: JsonObject | null;
    nodeId?: string;
  }) => Promise<TriggerExtraContext> | TriggerExtraContext;
};

const manualTriggerTRPCPlugin = <
  Context extends JsonObject,
  TriggerExtraContext extends JsonObject,
>(
  callbacks: PluginCallbacks<Context, TriggerExtraContext>,
  hooks?: ApiHooks,
) =>
  defineTrpcPlugin({
    name: 'manual-trigger',
    hooks,
    createRouter: ({ router, procedure }) => {
      return router({
        listTriggers: procedure
          .input(
            z.object({
              context: callbacks.contextSchema,
            }),
          )
          .query(({ input }) => {
            return callbacks.listTriggers(input);
          }),
        saveTrigger: procedure
          .input(
            z.object({
              nodeId: z.string().brand('nodeId'),
              payloadSchema: z.unknown().nullable(),
              extras: callbacks.contextSchema,
            }),
          )
          .mutation(({ input }) => {
            return callbacks.saveTrigger({
              ...input,
              payloadSchema: input.payloadSchema as z.core.JSONSchema._JSONSchema | null,
            });
          }),
        deleteTrigger: procedure
          .input(
            z.object({
              nodeId: z.string().brand('nodeId'),
              extras: callbacks.contextSchema,
            }),
          )
          .mutation(({ input }) => {
            return callbacks.deleteTrigger(input);
          }),
      });
    },
  });

const manualTriggerHTTPPlugin = <
  Context extends JsonObject,
  TriggerExtraContext extends JsonObject,
>(
  callbacks: PluginCallbacks<Context, TriggerExtraContext>,
) =>
  defineHttpPlugin({
    path: '/trigger/manual',
    handler: async (req) => {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const payload = manualTriggerPayloadSchema.safeParse(await req.json());
      if (!payload.success) {
        return new Response(`Invalid input: ${payload.error.message}`, { status: 400 });
      }
      const parsedContext = callbacks.contextSchema.safeParse(payload.data.context);
      if (!parsedContext.success) {
        return new Response(`Invalid input: ${parsedContext.error.message}`, { status: 400 });
      }
      const input = {
        context: parsedContext.data,
        data: (payload.data.data as JsonObject | null) ?? null,
        nodeId: payload.data.nodeId,
      };
      const extraContext = await callbacks.preCheck(input);
      const workflowContext: ManualTriggerContext<Context> = {
        ...parsedContext.data,
        trigger: {
          type: 'manual',
          id: `manual:${input.nodeId ?? 'default'}`,
          data: input.data,
        },
      };
      const eventId = await callbacks.triggerCallback({
        ...extraContext,
        ...workflowContext,
      });
      return Response.json({
        eventId,
      });
    },
  });

/**
 * Creates the manual trigger integration pair: a tRPC API for saving trigger metadata plus the
 * `/trigger/manual` HTTP endpoint used to start ad-hoc runs.
 *
 * `preCheck` can enforce host-specific authorization and add execution context before
 * `triggerCallback` dispatches the run.
 */
export const manualTriggerPlugin = <
  Context extends JsonObject = JsonObject,
  TriggerExtraContext extends JsonObject = JsonObject,
>(
  callbacks: PluginCallbacks<Context, TriggerExtraContext>,
  hooks?: ApiHooks,
) => [manualTriggerTRPCPlugin(callbacks, hooks), manualTriggerHTTPPlugin(callbacks)];

export type ManualTriggerPlugin = ReturnType<typeof manualTriggerTRPCPlugin>;
