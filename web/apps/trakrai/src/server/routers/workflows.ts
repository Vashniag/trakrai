import { sql } from 'drizzle-orm';

import { appDefinition, device, externalMessage, tiltEvent, violationEvent } from '@/db/schema';
import { adminProcedure, createTRPCRouter } from '@/server/trpc';

const countExpression = sql<number>`cast(count(*) as int)`;

export const workflowsRouter = createTRPCRouter({
  summary: adminProcedure.query(async ({ ctx }) => {
    const [deviceCount, appCount, messageCount, violationCount, tiltCount] = await Promise.all([
      ctx.db.select({ total: countExpression }).from(device),
      ctx.db.select({ total: countExpression }).from(appDefinition),
      ctx.db.select({ total: countExpression }).from(externalMessage),
      ctx.db.select({ total: countExpression }).from(violationEvent),
      ctx.db.select({ total: countExpression }).from(tiltEvent),
    ]);

    return {
      counts: {
        apps: appCount[0]?.total ?? 0,
        devices: deviceCount[0]?.total ?? 0,
        externalMessages: messageCount[0]?.total ?? 0,
        tiltEvents: tiltCount[0]?.total ?? 0,
        violationEvents: violationCount[0]?.total ?? 0,
      },
      lanes: [
        {
          basis: 'Fluxery-first package architecture',
          key: 'cloud-workflows',
          label: 'Cloud workflows',
          nextStep: 'Persist cloud workflow definitions and attach runtime plugins.',
          status: 'planned',
        },
        {
          basis: 'Dedicated workflow-engine process consuming the Redis frame queue',
          key: 'device-workflows',
          label: 'Device workflows',
          nextStep: 'Attach ROI, send-violation-to-cloud, and audio-alert nodes.',
          status: 'foundation',
        },
        {
          basis: 'Schema-hash distribution and node-schema generation',
          key: 'schema-distribution',
          label: 'Schema distribution',
          nextStep: 'Expose manifests and distribution APIs for device/editor parity.',
          status: 'next',
        },
      ],
      serviceBoundaries: [
        'ai-inference only performs model inference and publishes workflow queue envelopes.',
        'workflow-engine hydrates detection state from Redis and will own node execution.',
        'cloud-comm forwards metadata toward /trpc/external/... without interpreting business packets.',
        'transfer and media services remain separate durable workers for upload and recording.',
      ],
      targetEndpoints: ['/trpc/external/violations', '/trpc/external/tilts'],
    };
  }),
});
