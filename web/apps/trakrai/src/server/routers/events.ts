import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { device, externalMessage, storageObject, tiltEvent, violationEvent } from '@/db/schema';
import { adminProcedure, createTRPCRouter } from '@/server/trpc';

const countExpression = sql<number>`cast(count(*) as int)`;

type EventLaneRow = {
  createdAt: Date;
  deviceName: string | null;
  devicePublicId: string | null;
  id: string;
  severity: string;
  summary: string | null;
  title: string;
  type: 'tilt' | 'violation';
};

export const eventsRouter = createTRPCRouter({
  summary: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(8),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 8;

      const [
        messageCount,
        violationCount,
        tiltCount,
        storageCount,
        recentMessages,
        recentViolations,
        recentTilts,
      ] = await Promise.all([
        ctx.db.select({ total: countExpression }).from(externalMessage),
        ctx.db.select({ total: countExpression }).from(violationEvent),
        ctx.db.select({ total: countExpression }).from(tiltEvent),
        ctx.db.select({ total: countExpression }).from(storageObject),
        ctx.db
          .select({
            createdAt: externalMessage.createdAt,
            id: externalMessage.id,
            messageType: externalMessage.messageType,
            requestPath: externalMessage.requestPath,
            sourceId: externalMessage.sourceId,
            status: externalMessage.status,
            target: externalMessage.target,
          })
          .from(externalMessage)
          .orderBy(desc(externalMessage.createdAt))
          .limit(limit),
        ctx.db
          .select({
            createdAt: violationEvent.occurredAt,
            deviceName: device.name,
            devicePublicId: violationEvent.devicePublicId,
            id: violationEvent.id,
            severity: violationEvent.severity,
            summary: violationEvent.summary,
            title: violationEvent.title,
          })
          .from(violationEvent)
          .leftJoin(device, eq(violationEvent.deviceId, device.id))
          .orderBy(desc(violationEvent.occurredAt))
          .limit(limit),
        ctx.db
          .select({
            createdAt: tiltEvent.occurredAt,
            deviceName: device.name,
            devicePublicId: tiltEvent.devicePublicId,
            id: tiltEvent.id,
            severity: tiltEvent.severity,
            summary: tiltEvent.summary,
            title: tiltEvent.title,
          })
          .from(tiltEvent)
          .leftJoin(device, eq(tiltEvent.deviceId, device.id))
          .orderBy(desc(tiltEvent.occurredAt))
          .limit(limit),
      ]);

      const recentEvents: EventLaneRow[] = [
        ...recentViolations.map((event) => ({ ...event, type: 'violation' as const })),
        ...recentTilts.map((event) => ({ ...event, type: 'tilt' as const })),
      ]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);

      return {
        counts: {
          externalMessages: messageCount[0]?.total ?? 0,
          storageObjects: storageCount[0]?.total ?? 0,
          tiltEvents: tiltCount[0]?.total ?? 0,
          violationEvents: violationCount[0]?.total ?? 0,
        },
        recentEvents,
        recentMessages,
      };
    }),
});
