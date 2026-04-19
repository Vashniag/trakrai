import { accessControlRouter } from './access-control';
import { devicesRouter } from './devices';
import { packageArtifactsRouter } from './package-artifacts';
import { workspaceRouter } from './workspace/router';

import type { inferRouterOutputs } from '@trpc/server';

import { createCallerFactory, createTRPCRouter, publicProcedure } from '../trpc';

export const appRouter = createTRPCRouter({
  accessControl: accessControlRouter,
  health: publicProcedure.query(() => {
    return { status: 'ok' as const, timestamp: new Date() };
  }),
  devices: devicesRouter,
  packageArtifacts: packageArtifactsRouter,
  workspace: workspaceRouter,
});

export type AppRouter = typeof appRouter;
export type RouterOutput = inferRouterOutputs<AppRouter>;

export const createCaller = createCallerFactory(appRouter);
