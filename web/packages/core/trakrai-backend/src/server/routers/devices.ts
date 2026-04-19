import { randomBytes, randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import {
  department,
  device,
  deviceComponentCatalog,
  deviceComponentInstallation,
  factory,
} from '../../db/schema';
import {
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  deleteObjectAuthzRelations,
  getDeviceComponentAccessForUser,
  getReadableDeviceIdsForUser,
  getUserManagementScopeIds,
  isSysAdminRole,
  setObjectParentRelation,
  writeAuthzTuples,
} from '../../lib/authz';
import { createTRPCRouter, type Database, protectedProcedure } from '../trpc';

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_NAME_LENGTH = 255;
const DEVICE_ACCESS_TOKEN_BYTES = 24;
const DEVICE_NOT_FOUND_MESSAGE = 'Device not found.';
const DEVICE_RECORD_ID_MESSAGE = 'Device record ID must be a UUID';

const normalizeOptionalString = (value: string): string | null => {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
};

const createDeviceAccessToken = (): string =>
  `trd_${randomBytes(DEVICE_ACCESS_TOKEN_BYTES).toString('hex')}`;

const requireSysAdmin = (role: string | null | undefined) => {
  if (!isSysAdminRole(role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only sysadmins can manage registered devices.',
    });
  }
};

const buildComponentParentTuple = (componentId: string, deviceId: string) => ({
  object: `${AUTHZ_TYPE_DEVICE_COMPONENT}:${componentId}`,
  relation: 'parent',
  user: `${AUTHZ_TYPE_DEVICE}:${deviceId}`,
});

const createDeviceInputSchema = z.object({
  departmentId: z.string().uuid('Department ID must be a UUID'),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  name: z
    .string()
    .trim()
    .min(1, 'Device name is required')
    .max(MAX_NAME_LENGTH, 'Device name must be 255 characters or fewer'),
});

const updateDeviceInputSchema = z.object({
  departmentId: z.string().uuid('Department ID must be a UUID'),
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

const deviceListItemSchema = z.object({
  accessToken: z.string().nullable(),
  canManageUsers: z.boolean(),
  createdAt: z.date(),
  departmentId: z.string(),
  departmentName: z.string(),
  description: z.string().nullable(),
  deviceId: z.string(),
  factoryId: z.string(),
  factoryName: z.string(),
  id: z.string(),
  isActive: z.boolean(),
  name: z.string(),
  updatedAt: z.date(),
});

const routeComponentSchema = z.object({
  accessLevel: z.enum(['read', 'write']),
  componentKey: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  id: z.string(),
  navigationLabel: z.string(),
  rendererKey: z.string().nullable(),
  routePath: z.string().nullable(),
  serviceName: z.string(),
  sortOrder: z.number().int(),
});

const routeContextSchema = z.object({
  canManageUsers: z.boolean(),
  components: z.array(routeComponentSchema),
  device: deviceListItemSchema,
  gatewayAccessToken: z.string(),
  isSysadmin: z.boolean(),
});

const readJoinedDevices = async (db: Database, deviceIds?: string[]) => {
  if (deviceIds?.length === 0) {
    return [];
  }

  const baseQuery = db
    .select({
      accessToken: device.accessToken,
      createdAt: device.createdAt,
      departmentId: department.id,
      departmentName: department.name,
      description: device.description,
      deviceId: device.id,
      factoryId: factory.id,
      factoryName: factory.name,
      id: device.id,
      isActive: device.isActive,
      name: device.name,
      updatedAt: device.updatedAt,
    })
    .from(device)
    .innerJoin(department, eq(department.id, device.departmentId))
    .innerJoin(factory, eq(factory.id, department.factoryId))
    .orderBy(desc(device.createdAt), desc(device.id));

  return deviceIds === undefined ? baseQuery : baseQuery.where(inArray(device.id, deviceIds));
};

export const devicesRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createDeviceInputSchema)
    .output(deviceListItemSchema)
    .mutation(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const deviceId = randomUUID();
      const [createdDevice] = await ctx.db
        .insert(device)
        .values({
          accessToken: createDeviceAccessToken(),
          departmentId: input.departmentId,
          description: normalizeOptionalString(input.description),
          id: deviceId,
          name: input.name,
        })
        .returning();

      if (createdDevice === undefined) {
        throw new Error('Failed to create device.');
      }

      await setObjectParentRelation(
        AUTHZ_TYPE_DEVICE,
        createdDevice.id,
        AUTHZ_TYPE_DEPARTMENT,
        createdDevice.departmentId,
      );

      const defaultComponents = await ctx.db
        .select({
          componentKey: deviceComponentCatalog.key,
          defaultEnabled: deviceComponentCatalog.defaultEnabled,
        })
        .from(deviceComponentCatalog);

      if (defaultComponents.length > 0) {
        const createdInstallations = await ctx.db
          .insert(deviceComponentInstallation)
          .values(
            defaultComponents.map((component) => ({
              componentKey: component.componentKey,
              deviceId: createdDevice.id,
              enabled: component.defaultEnabled,
              id: randomUUID(),
            })),
          )
          .returning();

        await writeAuthzTuples(
          createdInstallations.map((installation) =>
            buildComponentParentTuple(installation.id, installation.deviceId),
          ),
        );
      }

      const [joinedDevice] = await readJoinedDevices(ctx.db, [createdDevice.id]);
      if (joinedDevice === undefined) {
        throw new Error('Failed to load created device.');
      }

      return {
        ...joinedDevice,
        canManageUsers: true,
      };
    }),
  delete: protectedProcedure
    .input(deleteDeviceInputSchema)
    .output(deviceListItemSchema)
    .mutation(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const [joinedDevice, installationRows] = await Promise.all([
        readJoinedDevices(ctx.db, [input.id]).then((rows) => rows[0]),
        ctx.db
          .select({ id: deviceComponentInstallation.id })
          .from(deviceComponentInstallation)
          .where(eq(deviceComponentInstallation.deviceId, input.id)),
      ]);

      if (joinedDevice === undefined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: DEVICE_NOT_FOUND_MESSAGE,
        });
      }

      for (const installation of installationRows) {
        await deleteObjectAuthzRelations(AUTHZ_TYPE_DEVICE_COMPONENT, installation.id);
      }
      await deleteObjectAuthzRelations(AUTHZ_TYPE_DEVICE, input.id);

      await ctx.db.delete(device).where(eq(device.id, input.id));

      return {
        ...joinedDevice,
        canManageUsers: true,
      };
    }),
  getById: protectedProcedure
    .input(getDeviceInputSchema)
    .output(deviceListItemSchema)
    .query(async ({ input, ctx }) => {
      const [joinedDevice] = await readJoinedDevices(ctx.db, [input.id]);
      if (joinedDevice === undefined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: DEVICE_NOT_FOUND_MESSAGE,
        });
      }

      if (!isSysAdminRole(ctx.user.role)) {
        const readableDeviceIds = await getReadableDeviceIdsForUser(ctx.user.id);
        if (!readableDeviceIds.has(input.id)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this device.',
          });
        }
      }

      const managementScopeIds = isSysAdminRole(ctx.user.role)
        ? { deviceIds: new Set([input.id]) }
        : await getUserManagementScopeIds(ctx.user.id);

      return {
        ...joinedDevice,
        accessToken: isSysAdminRole(ctx.user.role) ? joinedDevice.accessToken : null,
        canManageUsers: managementScopeIds.deviceIds.has(input.id),
      };
    }),
  getRouteContext: protectedProcedure
    .input(getDeviceInputSchema)
    .output(routeContextSchema)
    .query(async ({ input, ctx }) => {
      const [joinedDevice] = await readJoinedDevices(ctx.db, [input.id]);
      if (joinedDevice === undefined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: DEVICE_NOT_FOUND_MESSAGE,
        });
      }

      const sysadmin = isSysAdminRole(ctx.user.role);

      try {
        const access = await getDeviceComponentAccessForUser(
          ctx.db,
          ctx.user.id,
          input.id,
          sysadmin,
        );
        return {
          canManageUsers: access.canManageUsers,
          components: access.components.map((component) => ({
            accessLevel: component.accessLevel,
            componentKey: component.componentKey,
            description: component.description,
            enabled: component.enabled,
            id: component.id,
            navigationLabel: component.navigationLabel,
            rendererKey: component.rendererKey,
            routePath: component.routePath,
            serviceName: component.serviceName,
            sortOrder: component.sortOrder,
          })),
          device: {
            ...joinedDevice,
            accessToken: sysadmin ? joinedDevice.accessToken : null,
            canManageUsers: access.canManageUsers,
          },
          gatewayAccessToken: access.gatewayAccessToken,
          isSysadmin: sysadmin,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            error instanceof Error ? error.message : 'You do not have access to this device.',
        });
      }
    }),
  list: protectedProcedure
    .output(
      z.object({
        devices: z.array(deviceListItemSchema),
        isSysadmin: z.boolean(),
      }),
    )
    .query(async ({ ctx }) => {
      const sysadmin = isSysAdminRole(ctx.user.role);
      const joinedDevices = sysadmin
        ? await readJoinedDevices(ctx.db)
        : await readJoinedDevices(
            ctx.db,
            Array.from(await getReadableDeviceIdsForUser(ctx.user.id)),
          );

      const manageableDeviceIds = sysadmin
        ? new Set(joinedDevices.map((currentDevice) => currentDevice.id))
        : (await getUserManagementScopeIds(ctx.user.id)).deviceIds;

      return {
        devices: joinedDevices.map((currentDevice) => ({
          ...currentDevice,
          accessToken: sysadmin ? currentDevice.accessToken : null,
          canManageUsers: manageableDeviceIds.has(currentDevice.id),
        })),
        isSysadmin: sysadmin,
      };
    }),
  update: protectedProcedure
    .input(updateDeviceInputSchema)
    .output(deviceListItemSchema)
    .mutation(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const [updatedDevice] = await ctx.db
        .update(device)
        .set({
          departmentId: input.departmentId,
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

      await setObjectParentRelation(
        AUTHZ_TYPE_DEVICE,
        updatedDevice.id,
        AUTHZ_TYPE_DEPARTMENT,
        updatedDevice.departmentId,
      );

      const [joinedDevice] = await readJoinedDevices(ctx.db, [updatedDevice.id]);
      if (joinedDevice === undefined) {
        throw new Error('Failed to load updated device.');
      }

      return {
        ...joinedDevice,
        canManageUsers: true,
      };
    }),
});
