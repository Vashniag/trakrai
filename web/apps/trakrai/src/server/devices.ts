import { randomBytes, randomUUID } from 'node:crypto';

import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { device } from '@/db/device-schema';

type CreateDeviceInput = Readonly<{
  description: string | null;
  deviceId: string;
  name: string;
}>;

type UpdateDeviceInput = Readonly<{
  description: string | null;
  id: string;
  isActive: boolean;
  name: string;
}>;

const DEVICE_ACCESS_TOKEN_BYTES = 24;

const createDeviceAccessToken = (): string =>
  `trd_${randomBytes(DEVICE_ACCESS_TOKEN_BYTES).toString('hex')}`;

export const listDevices = async () =>
  db.select().from(device).orderBy(desc(device.createdAt), desc(device.deviceId));

export const createDevice = async (input: CreateDeviceInput) => {
  const [createdDevice] = await db
    .insert(device)
    .values({
      accessToken: createDeviceAccessToken(),
      description: input.description,
      deviceId: input.deviceId,
      id: randomUUID(),
      name: input.name,
    })
    .returning();

  if (createdDevice === undefined) {
    throw new Error('Failed to create device.');
  }

  return createdDevice;
};

export const updateDevice = async (input: UpdateDeviceInput) => {
  const [updatedDevice] = await db
    .update(device)
    .set({
      description: input.description,
      isActive: input.isActive,
      name: input.name,
    })
    .where(eq(device.id, input.id))
    .returning();

  return updatedDevice ?? null;
};

export const deleteDevice = async (id: string) => {
  const [deletedDevice] = await db.delete(device).where(eq(device.id, id)).returning();
  return deletedDevice ?? null;
};

export const getDeviceByAccessToken = async (accessToken: string) => {
  const [matchedDevice] = await db
    .select()
    .from(device)
    .where(eq(device.accessToken, accessToken))
    .limit(1);

  return matchedDevice ?? null;
};
