import { randomBytes, randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { device } from '../../db/schema';
import { createTRPCRouter, protectedProcedure } from '../trpc';

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_NAME_LENGTH = 255;
const MAX_DEVICE_ID_LENGTH = 255;
const DEVICE_ACCESS_TOKEN_BYTES = 24;
const DEVICE_NOT_FOUND_MESSAGE = 'Device not found.';
const DEVICE_RECORD_ID_MESSAGE = 'Device record ID must be a UUID';

const normalizeOptionalString = (value: string): string | null => {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
};

const createDeviceAccessToken = (): string =>
  `trd_${randomBytes(DEVICE_ACCESS_TOKEN_BYTES).toString('hex')}`;

const createDeviceInputSchema = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  deviceId: z
    .string()
    .trim()
    .min(1, 'Device ID is required')
    .max(MAX_DEVICE_ID_LENGTH, 'Device ID must be 255 characters or fewer'),
  name: z
    .string()
    .trim()
    .min(1, 'Device name is required')
    .max(MAX_NAME_LENGTH, 'Device name must be 255 characters or fewer'),
});

const updateDeviceInputSchema = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  id: z.string().uuid(DEVICE_RECORD_ID_MESSAGE),
  isActive: z.boolean(),
  name: z
    .string()
    .trim()
    .min(1, 'Device name is required')
    .max(MAX_NAME_LENGTH, 'Device name must be 255 characters or fewer'),
});

const deleteDeviceInputSchema = z.object({
  id: z.string().uuid(DEVICE_RECORD_ID_MESSAGE),
});

const getDeviceInputSchema = z.object({
  id: z.string().uuid(DEVICE_RECORD_ID_MESSAGE),
});

const deviceOutputSchema = z.object({
  accessToken: z.string(),
  createdAt: z.date(),
  description: z.string().nullable(),
  deviceId: z.string(),
  id: z.string(),
  isActive: z.boolean(),
  name: z.string(),
  updatedAt: z.date(),
});

const isPgUniqueViolation = (error: unknown, constraintName: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '23505' &&
  'constraint' in error &&
  error.constraint === constraintName;

export const devicesRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createDeviceInputSchema)
    .output(deviceOutputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const [createdDevice] = await ctx.db
          .insert(device)
          .values({
            accessToken: createDeviceAccessToken(),
            description: normalizeOptionalString(input.description),
            deviceId: input.deviceId,
            id: randomUUID(),
            name: input.name,
          })
          .returning();

        if (createdDevice === undefined) {
          throw new Error('Failed to create device.');
        }

        return createdDevice;
      } catch (error) {
        if (isPgUniqueViolation(error, 'device_device_id_unique')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A device with this device ID already exists.',
          });
        }

        throw error;
      }
    }),
  delete: protectedProcedure
    .input(deleteDeviceInputSchema)
    .output(deviceOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const [deletedDevice] = await ctx.db
        .delete(device)
        .where(eq(device.id, input.id))
        .returning();
      if (deletedDevice === undefined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: DEVICE_NOT_FOUND_MESSAGE,
        });
      }

      return deletedDevice;
    }),
  getById: protectedProcedure
    .input(getDeviceInputSchema)
    .output(deviceOutputSchema)
    .query(async ({ input, ctx }) => {
      const [foundDevice] = await ctx.db
        .select()
        .from(device)
        .where(eq(device.id, input.id))
        .limit(1);

      if (foundDevice === undefined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: DEVICE_NOT_FOUND_MESSAGE,
        });
      }

      return foundDevice;
    }),
  list: protectedProcedure
    .output(
      z.object({
        devices: z.array(deviceOutputSchema),
      }),
    )
    .query(async ({ ctx }) => ({
      devices: await ctx.db
        .select()
        .from(device)
        .orderBy(desc(device.createdAt), desc(device.deviceId)),
    })),
  update: protectedProcedure
    .input(updateDeviceInputSchema)
    .output(deviceOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const [updatedDevice] = await ctx.db
        .update(device)
        .set({
          description: normalizeOptionalString(input.description),
          isActive: input.isActive,
          name: input.name,
        })
        .where(eq(device.id, input.id))
        .returning();
      if (updatedDevice === undefined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: DEVICE_NOT_FOUND_MESSAGE,
        });
      }

      return updatedDevice;
    }),
});
