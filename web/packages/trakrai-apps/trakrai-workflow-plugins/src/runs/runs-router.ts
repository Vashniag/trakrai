import { defineTrpcPlugin, type ApiHooks } from '@trakrai-workflow/core';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';

import {
  getNodeOutputFromRunData,
  getRunData,
  getRuns,
  getTraceResult,
} from './inngest-graphql/helpers';

const inngestGraphQLClients = new Map<string, GraphQLClient>();

const getInngestGraphQLClient = (inngestBaseUrl: string) => {
  const existingClient = inngestGraphQLClients.get(inngestBaseUrl);
  if (existingClient !== undefined) {
    return existingClient;
  }

  const client = new GraphQLClient(`${inngestBaseUrl}/v0/gql`);
  inngestGraphQLClients.set(inngestBaseUrl, client);
  return client;
};

/**
 * Creates the tRPC plugin used by the editor's runs sidebar to query Inngest execution history.
 *
 * The host app must point `inngestBaseUrl` at an Inngest dev server or API that exposes the GraphQL
 * endpoints consumed by the run detail helpers in this package.
 */
export const runsPlugin = ({ inngestBaseUrl }: { inngestBaseUrl: string }, hooks?: ApiHooks) =>
  defineTrpcPlugin({
    name: 'runs',
    hooks,
    createRouter: ({ router, procedure }) => {
      return router({
        getRuns: procedure
          .input(
            z.object({
              startTime: z.date(),
              celQuery: z.string(),
            }),
          )
          .query(({ input }) => {
            return getRuns(
              getInngestGraphQLClient(inngestBaseUrl),
              input.startTime,
              input.celQuery,
            );
          }),
        getRunDetails: procedure
          .input(
            z.object({
              runId: z.string(),
            }),
          )
          .query(async ({ input }) => {
            const run = await getRunData(getInngestGraphQLClient(inngestBaseUrl), input.runId);
            if (run === undefined || run === null) {
              throw new Error(`Run ${input.runId} not found`);
            }
            return run;
          }),
        getNodeRunDetails: procedure
          .input(
            z.object({
              runId: z.string(),
              nodeId: z.string(),
            }),
          )
          .query(async ({ input }) => {
            const runData = await getRunData(getInngestGraphQLClient(inngestBaseUrl), input.runId);
            return getNodeOutputFromRunData(
              getInngestGraphQLClient(inngestBaseUrl),
              runData,
              input.nodeId,
            );
          }),
        getTraceResult: procedure
          .input(
            z.object({
              outputId: z.string(),
            }),
          )
          .query(async ({ input }) => {
            const traceResult = await getTraceResult(
              getInngestGraphQLClient(inngestBaseUrl),
              input.outputId,
            );
            const data = (traceResult.data ?? '{}') as string;
            return data.length > 0 ? data : '{}';
          }),
      });
    },
  });

export type RunsPlugin = ReturnType<typeof runsPlugin>;
