import { and, desc, eq, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { department, device, deviceToken, factory, headquarter } from '@/db/schema';
import { generateDeviceToken } from '@/lib/device-tokens';
import { adminProcedure, createTRPCRouter } from '@/server/trpc';

const metadataSchema = z.record(z.string(), z.unknown()).default({});

const buildDevicePublicId = () =>
  `dev_${Date.now()}_${randomBytes(6).toString('hex')}`;

export const devicesRouter = createTRPCRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    const devices = await ctx.db
      .select({
        id: device.id,
        publicId: device.publicId,
        name: device.name,
        description: device.description,
        status: device.status,
        lastSeenAt: device.lastSeenAt,
        createdAt: device.createdAt,
        departmentId: department.id,
        departmentName: department.name,
        factoryId: factory.id,
        factoryName: factory.name,
        headquarterId: headquarter.id,
        headquarterName: headquarter.name,
      })
      .from(device)
      .leftJoin(department, eq(device.departmentId, department.id))
      .leftJoin(factory, eq(department.factoryId, factory.id))
      .leftJoin(headquarter, eq(factory.headquarterId, headquarter.id))
      .orderBy(desc(device.createdAt));

    return {
      devices,
    };
  }),

  create: adminProcedure
    .input(
      z.object({
        publicId: z.string().trim().min(6).optional(),
        name: z.string().trim().min(2),
        description: z.string().trim().optional(),
        departmentId: z.string().uuid().nullable().optional(),
        metadata: metadataSchema,
        tokenLabel: z.string().trim().min(2).default('Primary token'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const publicId = input.publicId ?? buildDevicePublicId();
      const token = generateDeviceToken();

      const createdDevice = (
        await ctx.db
        .insert(device)
        .values({
          publicId,
          name: input.name,
          description: input.description,
          departmentId: input.departmentId ?? null,
          metadata: input.metadata,
          status: 'active',
        })
        .returning()
      )[0];

      if (!createdDevice) {
        throw new Error('Failed to create device record');
      }

      const createdToken = (
        await ctx.db
        .insert(deviceToken)
        .values({
          deviceId: createdDevice.id,
          label: input.tokenLabel,
          tokenPrefix: token.tokenPrefix,
          tokenHash: token.tokenHash,
          createdByUserId: ctx.user.id,
        })
        .returning()
      )[0];

      if (!createdToken) {
        throw new Error('Failed to create device token');
      }

      return {
        device: createdDevice,
        token: {
          id: createdToken.id,
          label: createdToken.label,
          tokenPrefix: createdToken.tokenPrefix,
          plainTextToken: token.plainTextToken,
        },
      };
    }),

  rotateToken: adminProcedure
    .input(
      z.object({
        deviceId: z.string().uuid(),
        label: z.string().trim().min(2).default('Rotated token'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(deviceToken)
        .set({
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(deviceToken.deviceId, input.deviceId), isNull(deviceToken.revokedAt)),
        );

      const token = generateDeviceToken();
      const createdToken = (
        await ctx.db
        .insert(deviceToken)
        .values({
          deviceId: input.deviceId,
          label: input.label,
          tokenPrefix: token.tokenPrefix,
          tokenHash: token.tokenHash,
          createdByUserId: ctx.user.id,
        })
        .returning()
      )[0];

      if (!createdToken) {
        throw new Error('Failed to rotate device token');
      }

      return {
        token: {
          id: createdToken.id,
          label: createdToken.label,
          tokenPrefix: createdToken.tokenPrefix,
          plainTextToken: token.plainTextToken,
        },
      };
    }),
});
