import {
  defineHttpPlugin,
  defineTrpcPlugin,
  type ApiHooks,
  type JsonObject,
} from '@trakrai-workflow/core';
import { z } from 'zod';

const cronTriggerInputSchema = z.object({
  cronTriggerId: z.string().min(1),
});

const activeCronTriggerSchema = z.object({
  cronExpression: z.string().min(1),
  cronTriggerId: z.string().min(1),
  flowId: z.string().min(1),
  nodeId: z.string().min(1),
});

const activeCronTriggersSchema = z.array(activeCronTriggerSchema);

type WorkflowContext = { trigger: { type: string; id: string } };

type PluginCallbacks<ExtraContext extends JsonObject> = {
  listActiveTriggers: () => Promise<z.infer<typeof activeCronTriggersSchema>>;
  saveTrigger: (input: {
    cronExpression: string;
    extras: ExtraContext;
    nodeId: string;
  }) => Promise<void>;
  deleteTrigger: (input: { extras: ExtraContext; nodeId: string }) => Promise<void>;
  triggerCallback: (workflowContext: WorkflowContext & ExtraContext) => Promise<string>;
  preCheck: (
    input: z.infer<typeof cronTriggerInputSchema>,
  ) => Promise<ExtraContext & { nodeId: string }> | (ExtraContext & { nodeId: string });
};

const cronTriggerTRPCPlugin = <ExtraContext extends JsonObject>(
  callbacks: PluginCallbacks<ExtraContext>,
  hooks?: ApiHooks,
) =>
  defineTrpcPlugin({
    name: 'cron-trigger',
    hooks,
    createRouter: ({ router, procedure }) => {
      return router({
        listActiveTriggers: procedure.output(activeCronTriggersSchema).query(() => {
          return callbacks.listActiveTriggers();
        }),
        saveTrigger: procedure
          .input(
            z.object({
              cronExpression: z.string(),
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

const cronTriggerHTTPPlugin = <ExtraContext extends JsonObject>(
  callbacks: PluginCallbacks<ExtraContext>,
) =>
  defineHttpPlugin({
    path: '/trigger/cron',
    handler: {
      GET: async () => {
        return Response.json(await callbacks.listActiveTriggers());
      },
      POST: async (req) => {
        const input = cronTriggerInputSchema.safeParse(await req.json());
        if (!input.success) {
          return new Response(`Invalid input: ${input.error.message}`, { status: 400 });
        }
        const extraContext = await callbacks.preCheck(input.data);
        const workflowContext: WorkflowContext = {
          trigger: {
            type: 'cron',
            id: `cron:${extraContext.nodeId}`,
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
    },
  });

/**
 * Creates the cron trigger integration pair: a tRPC management API plus the `/trigger/cron` HTTP
 * endpoint used by external schedulers.
 *
 * Host apps are responsible for persisting schedules in `saveTrigger`, exposing active schedules to
 * schedulers via `listActiveTriggers`, and authenticating or enriching inbound cron callbacks in
 * `preCheck`.
 */
export const cronTriggerPlugin = <ExtraContext extends JsonObject = JsonObject>(
  callbacks: PluginCallbacks<ExtraContext>,
  hooks?: ApiHooks,
) => [cronTriggerTRPCPlugin(callbacks, hooks), cronTriggerHTTPPlugin(callbacks)];

export type CronTriggerPlugin = ReturnType<typeof cronTriggerTRPCPlugin>;
