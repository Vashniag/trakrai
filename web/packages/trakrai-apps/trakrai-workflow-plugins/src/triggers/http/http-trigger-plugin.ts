import {
  defineHttpPlugin,
  defineTrpcPlugin,
  type ApiHooks,
  type JsonObject,
} from '@trakrai-workflow/core';
import { z } from 'zod';

const TOKEN_LENGTH_TO_DISPLAY = 4;

type TokenInfo = {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  token: string;
};

type PluginCallbacks<ExtraContext extends JsonObject> = {
  listTokens: (input: { extras: ExtraContext; nodeId: string }) => Promise<TokenInfo[]>;
  createToken: (input: { extras: ExtraContext; nodeId: string }) => Promise<{ token: string }>;
  deleteAllTokens: (input: { extras: ExtraContext; nodeId: string }) => Promise<number>;
  deleteToken: (input: { id: string }) => Promise<void>;
  preCheck: (
    input: z.infer<typeof httpTriggerInputSchema>,
  ) => Promise<ExtraContext & { nodeId: string }> | (ExtraContext & { nodeId: string });
  triggerCallback: (
    workflowContext: {
      trigger: { type: string; id: string; data?: JsonObject | null };
    } & ExtraContext,
  ) => Promise<string>;
};

const httpTriggerTRPCPlugin = <ExtraContext extends JsonObject>(
  callbacks: PluginCallbacks<ExtraContext>,
  hooks?: ApiHooks,
) =>
  defineTrpcPlugin({
    name: 'http-trigger',
    hooks,
    createRouter: ({ router, procedure }) => {
      return router({
        listTokens: procedure
          .input(
            z.object({
              nodeId: z.string().brand('nodeId'),
              extras: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .query(async ({ input }) => {
            const extras = input.extras as ExtraContext;
            const rawTokens = await callbacks.listTokens({ ...input, extras });
            return rawTokens.map((token) => ({
              ...token,
              displayToken: `${token.token.slice(0, TOKEN_LENGTH_TO_DISPLAY)}...${token.token.slice(-TOKEN_LENGTH_TO_DISPLAY)}`,
            }));
          }),
        createToken: procedure
          .input(
            z.object({
              nodeId: z.string().brand('nodeId'),
              extras: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .mutation(({ input }) => {
            const extras = input.extras as ExtraContext;
            return callbacks.createToken({ ...input, extras });
          }),
        deleteToken: procedure
          .input(
            z.object({
              id: z.string(),
            }),
          )
          .mutation(({ input }) => {
            return callbacks.deleteToken(input);
          }),
        deleteAllTokens: procedure
          .input(
            z.object({
              nodeId: z.string().brand('nodeId'),
              extras: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .mutation(async ({ input }) => {
            const extras = input.extras as ExtraContext;
            return callbacks.deleteAllTokens({ ...input, extras });
          }),
      });
    },
  });

const httpTriggerInputSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  token: z.string(),
});

const httpTriggerHTTPPlugin = <ExtraContext extends JsonObject>(
  callbacks: PluginCallbacks<ExtraContext>,
) =>
  defineHttpPlugin({
    path: '/trigger/http',
    handler: async (req) => {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const input = httpTriggerInputSchema.safeParse(await req.json());
      if (!input.success) {
        return new Response(`Invalid input: ${input.error.message}`, { status: 400 });
      }
      const { data } = input.data;
      const extraContext = await callbacks.preCheck(input.data);
      const workflowContext = {
        trigger: {
          type: 'http',
          id: `http:${extraContext.nodeId}`,
          data: data as JsonObject | null,
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
 * Creates the HTTP trigger integration pair: a tRPC token-management API plus the
 * `/trigger/http` webhook endpoint that starts workflows.
 *
 * `preCheck` is the host app's authentication and lookup hook. It must validate the incoming token
 * and return the `nodeId` that should receive the trigger along with any extra execution context.
 */
export const httpTriggerPlugin = <ExtraContext extends JsonObject = JsonObject>(
  callbacks: PluginCallbacks<ExtraContext>,
  hooks?: ApiHooks,
) => [httpTriggerTRPCPlugin(callbacks, hooks), httpTriggerHTTPPlugin(callbacks)];

export type HttpTriggerPlugin = ReturnType<typeof httpTriggerTRPCPlugin>;
