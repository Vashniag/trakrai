import { devicesRouter } from '@/server/routers/devices';
import { packageArtifactsRouter } from '@/server/routers/package-artifacts';
import { createCallerFactory, createTRPCRouter, publicProcedure } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

export const appRouter = createTRPCRouter({
  devices: devicesRouter,
  health: publicProcedure.query(() => {
    return { status: 'ok' as const, timestamp: new Date() };
  }),
  packageArtifacts: packageArtifactsRouter,
});

export type AppRouter = typeof appRouter;
export type RouterOutput = inferRouterOutputs<AppRouter>;

export const createCaller = createCallerFactory(appRouter);
