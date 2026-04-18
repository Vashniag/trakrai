import { devicesRouter } from './devices';
import { packageArtifactsRouter } from './package-artifacts';

import type { inferRouterOutputs } from '@trpc/server';

import { createCallerFactory, createTRPCRouter, publicProcedure } from '../trpc';

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => {
    return { status: 'ok' as const, timestamp: new Date() };
  }),
  devices: devicesRouter,
  packageArtifacts: packageArtifactsRouter,
});

export type AppRouter = typeof appRouter;
export type RouterOutput = inferRouterOutputs<AppRouter>;

export const createCaller = createCallerFactory(appRouter);
