import { initTRPC } from '@trpc/server';
import { z } from 'zod';

import type { OpenApiMeta } from 'trpc-to-openapi';

import { removeScheduledCronTrigger, upsertScheduledCronTrigger } from '../queue';

const cronTriggerSchema = z.object({
  cronExpression: z.string().min(1),
  cronTriggerId: z.string().min(1),
  flowId: z.string().uuid(),
  nodeId: z.string().uuid(),
});

const schedulerMutationResultSchema = z.object({
  ok: z.literal(true),
});

const t = initTRPC.meta<OpenApiMeta>().create();

export const schedulerRouter = t.router({
  health: t.procedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/health',
      },
    })
    .output(
      z.object({
        status: z.literal('ok'),
      }),
    )
    .query(() => ({
      status: 'ok' as const,
    })),
  upsertCronTrigger: t.procedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/cron-triggers/upsert',
      },
    })
    .input(cronTriggerSchema)
    .output(schedulerMutationResultSchema)
    .mutation(async ({ input }) => {
      await upsertScheduledCronTrigger(input);
      return { ok: true as const };
    }),
  deleteCronTrigger: t.procedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/cron-triggers/delete',
      },
    })
    .input(
      z.object({
        cronTriggerId: z.string().min(1),
      }),
    )
    .output(schedulerMutationResultSchema)
    .mutation(async ({ input }) => {
      await removeScheduledCronTrigger(input.cronTriggerId);
      return { ok: true as const };
    }),
});

export type SchedulerRouter = typeof schedulerRouter;
