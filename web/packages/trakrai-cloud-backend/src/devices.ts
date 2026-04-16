import { randomBytes, randomUUID } from 'node:crypto';

import { desc, eq, type InferSelectModel } from 'drizzle-orm';

import { device } from './db/device-schema';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

type CloudBackendDatabase = NodePgDatabase<Record<string, never>>;

type DeviceDatabase = NodePgDatabase<{
  device: typeof device;
}>;

const asDeviceDatabase = (db: CloudBackendDatabase): DeviceDatabase => db as unknown as DeviceDatabase;

export type DeviceRecord = InferSelectModel<typeof device>;

export type CreateDeviceInput = Readonly<{
  description: string | null;
  deviceId: string;
  name: string;
}>;

export type UpdateDeviceInput = Readonly<{
  description: string | null;
  id: string;
  isActive: boolean;
  name: string;
}>;

const DEVICE_ACCESS_TOKEN_BYTES = 24;

const createDeviceAccessToken = (): string =>
  `trd_${randomBytes(DEVICE_ACCESS_TOKEN_BYTES).toString('hex')}`;

export const listDevices = async (db: CloudBackendDatabase) =>
  asDeviceDatabase(db).select().from(device).orderBy(desc(device.createdAt), desc(device.deviceId));

export const createDevice = async (db: CloudBackendDatabase, input: CreateDeviceInput) => {
  const [createdDevice] = await asDeviceDatabase(db)
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

export const updateDevice = async (db: CloudBackendDatabase, input: UpdateDeviceInput) => {
  const [updatedDevice] = await asDeviceDatabase(db)
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

export const deleteDevice = async (db: CloudBackendDatabase, id: string) => {
  const [deletedDevice] = await asDeviceDatabase(db)
    .delete(device)
    .where(eq(device.id, id))
    .returning();
  return deletedDevice ?? null;
};

export const getDeviceByCredentials = async (
  db: CloudBackendDatabase,
  deviceId: string,
  accessToken: string,
) => {
  const [matchedDevice] = await asDeviceDatabase(db)
    .select()
    .from(device)
    .where(eq(device.deviceId, deviceId))
    .limit(1);

  if (
    matchedDevice === undefined ||
    matchedDevice.isActive === false ||
    matchedDevice.accessToken !== accessToken
  ) {
    return null;
  }

  return matchedDevice;
};
