import { adminRouter } from '@/server/routers/admin';
import { accessRouter } from '@/server/routers/access';
import { appsRouter } from '@/server/routers/apps';
import { devicesRouter } from '@/server/routers/devices';
import { eventsRouter } from '@/server/routers/events';
import { externalRouter } from '@/server/routers/external';
import { hierarchyRouter } from '@/server/routers/hierarchy';
import { storageRouter } from '@/server/routers/storage';
import { workflowsRouter } from '@/server/routers/workflows';
import { createCallerFactory, createTRPCRouter, publicProcedure } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

export const appRouter = createTRPCRouter({
  admin: adminRouter,
  access: accessRouter,
  apps: appsRouter,
  devices: devicesRouter,
  events: eventsRouter,
  external: externalRouter,
  health: publicProcedure.query(() => {
    return { status: 'ok' as const, timestamp: new Date() };
  }),
  hierarchy: hierarchyRouter,
  portal: accessRouter,
  storage: storageRouter,
  workflows: workflowsRouter,
});

export type AppRouter = typeof appRouter;
export type RouterOutput = inferRouterOutputs<AppRouter>;

export const createCaller = createCallerFactory(appRouter);
