import { createCallerFactory, createTRPCRouter, publicProcedure } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => {
    return { status: 'ok' as const, timestamp: new Date() };
  }),
});

export type AppRouter = typeof appRouter;
export type RouterOutput = inferRouterOutputs<AppRouter>;

export const createCaller = createCallerFactory(appRouter);
