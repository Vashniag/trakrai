import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { storageObject } from '@/db/schema';
import { authenticateDevice } from '@/lib/device-auth';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { createTRPCRouter, publicProcedure } from '@/server/trpc';

const metadataSchema = z.record(z.string(), z.unknown()).default({});

const buildTicket = () => randomBytes(24).toString('hex');

type StorageMetadata = Record<string, unknown> & {
  downloadToken?: string;
  downloadTokenExpiresAt?: string;
  localPath?: string;
  uploadToken?: string;
  uploadTokenExpiresAt?: string;
};

const asStorageMetadata = (value: unknown): StorageMetadata => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as StorageMetadata;
};

export const storageRouter = createTRPCRouter({
  issueDownloadTicket: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/download-ticket',
        tags: ['external'],
        summary: 'Issue a direct download ticket for a stored object',
      },
    })
    .input(
      z.object({
        accessToken: z.string().trim().min(12),
        deviceId: z.string().trim().min(3),
        objectKey: z.string().trim().min(3),
      }),
    )
    .output(
      z.object({
        downloadUrl: z.string().url(),
        expiresAt: z.date(),
        objectId: z.string().min(1),
        objectKey: z.string().min(3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await authenticateDevice(ctx, input);

      const [objectRecord] = await ctx.db
        .select()
        .from(storageObject)
        .where(eq(storageObject.objectKey, input.objectKey))
        .limit(1);

      if (!objectRecord) {
        throw new Error('Object not found');
      }

      const ticket = buildTicket();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const metadata = asStorageMetadata(objectRecord.metadata);

      await ctx.db
        .update(storageObject)
        .set({
          metadata: {
            ...metadata,
            downloadToken: ticket,
            downloadTokenExpiresAt: expiresAt.toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(storageObject.id, objectRecord.id));

      return {
        downloadUrl: `${getBaseUrl()}/api/storage/download/${objectRecord.id}?token=${ticket}`,
        expiresAt,
        objectId: objectRecord.id,
        objectKey: objectRecord.objectKey,
      };
    }),

  issueUploadTicket: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/upload-ticket',
        tags: ['external'],
        summary: 'Issue a direct upload ticket for a storage object',
      },
    })
    .input(
      z.object({
        accessToken: z.string().trim().min(12),
        contentType: z.string().trim().optional(),
        deviceId: z.string().trim().min(3),
        metadata: metadataSchema,
        objectKey: z.string().trim().min(3),
        purpose: z.string().trim().min(2),
      }),
    )
    .output(
      z.object({
        expiresAt: z.date(),
        objectId: z.string().min(1),
        objectKey: z.string().min(3),
        uploadMethod: z.literal('PUT'),
        uploadUrl: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const authenticatedDevice = await authenticateDevice(ctx, input);
      const ticket = buildTicket();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      const created = (
        await ctx.db
          .insert(storageObject)
          .values({
            contentType: input.contentType,
            createdByDeviceId: authenticatedDevice.deviceRecordId,
            metadata: {
              ...input.metadata,
              uploadToken: ticket,
              uploadTokenExpiresAt: expiresAt.toISOString(),
            },
            objectKey: input.objectKey,
            purpose: input.purpose,
            status: 'requested',
          })
          .returning()
      )[0];

      if (!created) {
        throw new Error('Failed to create storage object');
      }

      return {
        expiresAt,
        objectId: created.id,
        objectKey: created.objectKey,
        uploadMethod: 'PUT' as const,
        uploadUrl: `${getBaseUrl()}/api/storage/upload/${created.id}?token=${ticket}`,
      };
    }),
});
