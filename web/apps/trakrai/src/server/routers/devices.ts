import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createDevice, deleteDevice, listDevices, updateDevice } from '@/server/devices';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_NAME_LENGTH = 255;
const MAX_DEVICE_ID_LENGTH = 255;

const normalizeOptionalString = (value: string): string | null => {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
};

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
  id: z.string().uuid('Device record ID must be a UUID'),
  isActive: z.boolean(),
  name: z
    .string()
    .trim()
    .min(1, 'Device name is required')
    .max(MAX_NAME_LENGTH, 'Device name must be 255 characters or fewer'),
});

const deleteDeviceInputSchema = z.object({
  id: z.string().uuid('Device record ID must be a UUID'),
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
    .mutation(async ({ input }) => {
      try {
        return await createDevice({
          description: normalizeOptionalString(input.description),
          deviceId: input.deviceId,
          name: input.name,
        });
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
    .mutation(async ({ input }) => {
      const deletedDevice = await deleteDevice(input.id);
      if (deletedDevice === null) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Device not found.',
        });
      }

      return deletedDevice;
    }),
  list: protectedProcedure
    .output(
      z.object({
        devices: z.array(deviceOutputSchema),
      }),
    )
    .query(async () => ({
      devices: await listDevices(),
    })),
  update: protectedProcedure
    .input(updateDeviceInputSchema)
    .output(deviceOutputSchema)
    .mutation(async ({ input }) => {
      const updatedDevice = await updateDevice({
        description: normalizeOptionalString(input.description),
        id: input.id,
        isActive: input.isActive,
        name: input.name,
      });
      if (updatedDevice === null) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Device not found.',
        });
      }

      return updatedDevice;
    }),
});
