import { and, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  externalMessage,
  storageObject,
  tiltEvent,
  violationEvent,
} from '@/db/schema';
import { db as database } from '@/db';
import { authenticateDevice } from '@/lib/device-auth';
import { createTRPCRouter, publicProcedure } from '@/server/trpc';

const metadataSchema = z.record(z.string(), z.unknown()).default({});

const createStorageObjectIfPresent = async (
  ctx: { db: typeof import('@/db').db },
  objectKey: string | undefined,
  purpose: string,
  createdByDeviceId: string,
) => {
  if (!objectKey) {
    return null;
  }

  const [existing] = await ctx.db
    .select()
    .from(storageObject)
    .where(eq(storageObject.objectKey, objectKey))
    .limit(1);

  if (existing) {
    return existing;
  }

  const created = (
    await ctx.db
    .insert(storageObject)
    .values({
      objectKey,
      purpose,
      status: 'uploaded',
      createdByDeviceId,
    })
    .returning()
  )[0];

  return created;
};

export const externalRouter = createTRPCRouter({
  reportViolation: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/violations',
        tags: ['external'],
        summary: 'Store a violation event from a device',
      },
    })
    .input(
      z.object({
        deviceId: z.string().trim().min(3),
        accessToken: z.string().trim().min(12),
        correlationId: z.string().trim().optional(),
        title: z.string().trim().min(3),
        summary: z.string().trim().optional(),
        severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).default('medium'),
        imageObjectKey: z.string().trim().optional(),
        videoObjectKey: z.string().trim().optional(),
        occurredAt: z.coerce.date().optional(),
        payload: metadataSchema,
        attachments: metadataSchema,
      }),
    )
    .output(
      z.object({
        eventId: z.string().min(1),
        messageId: z.string().min(1),
        status: z.literal('accepted'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const authenticatedDevice = await authenticateDevice(ctx, input);
      const imageObject = await createStorageObjectIfPresent(
        ctx,
        input.imageObjectKey,
        'violation-image',
        authenticatedDevice.deviceRecordId,
      );
      const videoObject = await createStorageObjectIfPresent(
        ctx,
        input.videoObjectKey,
        'violation-video',
        authenticatedDevice.deviceRecordId,
      );

      const message = (
        await ctx.db
        .insert(externalMessage)
        .values({
          requestPath: '/trpc/external/violations',
          messageType: 'violation.reported',
          sourceType: 'device',
          sourceId: authenticatedDevice.publicId,
          correlationId: input.correlationId,
          target: 'trpc.external.violations',
          payload: input.payload,
          attachments: input.attachments,
          status: 'processed',
          processedAt: new Date(),
        })
        .returning()
      )[0];

      if (!message) {
        throw new Error('Failed to persist external violation message');
      }

      const event = (
        await ctx.db
        .insert(violationEvent)
        .values({
          externalMessageId: message.id,
          deviceId: authenticatedDevice.deviceRecordId,
          devicePublicId: authenticatedDevice.publicId,
          title: input.title,
          summary: input.summary,
          severity: input.severity,
          imageObjectId: imageObject?.id ?? null,
          videoObjectId: videoObject?.id ?? null,
          metadata: input.attachments,
          rawPayload: input.payload,
          occurredAt: input.occurredAt ?? new Date(),
        })
        .returning()
      )[0];

      if (!event) {
        throw new Error('Failed to persist violation event');
      }

      return {
        messageId: message.id,
        eventId: event.id,
        status: 'accepted' as const,
      };
    }),

  reportTilt: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tilts',
        tags: ['external'],
        summary: 'Store a tilt event from a device',
      },
    })
    .input(
      z.object({
        deviceId: z.string().trim().min(3),
        accessToken: z.string().trim().min(12),
        correlationId: z.string().trim().optional(),
        title: z.string().trim().min(3),
        summary: z.string().trim().optional(),
        angle: z.string().trim().optional(),
        severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).default('medium'),
        occurredAt: z.coerce.date().optional(),
        payload: metadataSchema,
        attachments: metadataSchema,
      }),
    )
    .output(
      z.object({
        eventId: z.string().min(1),
        messageId: z.string().min(1),
        status: z.literal('accepted'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const authenticatedDevice = await authenticateDevice(ctx, input);

      const message = (
        await ctx.db
        .insert(externalMessage)
        .values({
          requestPath: '/trpc/external/tilts',
          messageType: 'tilt.reported',
          sourceType: 'device',
          sourceId: authenticatedDevice.publicId,
          correlationId: input.correlationId,
          target: 'trpc.external.tilts',
          payload: input.payload,
          attachments: input.attachments,
          status: 'processed',
          processedAt: new Date(),
        })
        .returning()
      )[0];

      if (!message) {
        throw new Error('Failed to persist external tilt message');
      }

      const event = (
        await ctx.db
        .insert(tiltEvent)
        .values({
          externalMessageId: message.id,
          deviceId: authenticatedDevice.deviceRecordId,
          devicePublicId: authenticatedDevice.publicId,
          title: input.title,
          summary: input.summary,
          severity: input.severity,
          angle: input.angle,
          metadata: input.attachments,
          rawPayload: input.payload,
          occurredAt: input.occurredAt ?? new Date(),
        })
        .returning()
      )[0];

      if (!event) {
        throw new Error('Failed to persist tilt event');
      }

      return {
        messageId: message.id,
        eventId: event.id,
        status: 'accepted' as const,
      };
    }),
});
