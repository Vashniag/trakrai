import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { assertUserCanManageScope, requireSysAdmin } from './helpers';
import { readManagementConsoleData } from './management-console';
import { accessControlQueryProcedures } from './queries';
import {
  assignmentInputSchema,
  componentCatalogInputSchema,
  departmentInputSchema,
  deviceComponentInstallationInputSchema,
  factoryInputSchema,
  normalizeOptionalString,
  normalizeStringArray,
  removeAssignmentInputSchema,
  updateDepartmentInputSchema,
  updateFactoryInputSchema,
} from './schemas';

import {
  department,
  device,
  deviceComponentCatalog,
  deviceComponentInstallation,
  factory,
} from '../../../db/schema';
import {
  AUTHZ_RELATION_ADMIN,
  AUTHZ_RELATION_READER,
  AUTHZ_RELATION_VIEWER,
  AUTHZ_RELATION_WRITER,
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  AUTHZ_TYPE_FACTORY,
  replaceDirectUserRelation,
  setObjectParentRelation,
  writeAuthzTuples,
} from '../../../lib/authz';
import { createTRPCRouter, type Database, protectedProcedure } from '../../trpc';

const readInstallationOrThrow = async (db: Database, installationId: string) => {
  const [installation] = await db
    .select()
    .from(deviceComponentInstallation)
    .where(eq(deviceComponentInstallation.id, installationId))
    .limit(1);

  if (installation === undefined) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Component installation not found.',
    });
  }

  return installation;
};

const buildComponentParentTuple = (componentId: string, deviceId: string) => ({
  object: `${AUTHZ_TYPE_DEVICE_COMPONENT}:${componentId}`,
  relation: 'parent',
  user: `${AUTHZ_TYPE_DEVICE}:${deviceId}`,
});

export const accessControlRouter = createTRPCRouter({
  ...accessControlQueryProcedures,
  createCatalogEntry: protectedProcedure
    .input(componentCatalogInputSchema)
    .mutation(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const [createdEntry] = await ctx.db
        .insert(deviceComponentCatalog)
        .values({
          defaultEnabled: input.defaultEnabled,
          description: normalizeOptionalString(input.description),
          displayName: input.displayName,
          key: input.key,
          navigationLabel: input.navigationLabel,
          readActions: normalizeStringArray(input.readActions),
          rendererKey: normalizeOptionalString(input.rendererKey),
          routePath: normalizeOptionalString(input.routePath),
          serviceName: input.serviceName,
          sortOrder: input.sortOrder,
          writeActions: normalizeStringArray(input.writeActions),
        })
        .returning();

      if (createdEntry === undefined) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create device app catalog entry.',
        });
      }

      const existingDevices = await ctx.db.select({ id: device.id }).from(device);
      if (existingDevices.length > 0) {
        const createdInstallations = await ctx.db
          .insert(deviceComponentInstallation)
          .values(
            existingDevices.map((currentDevice) => ({
              componentKey: createdEntry.key,
              deviceId: currentDevice.id,
              enabled: createdEntry.defaultEnabled,
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

      return createdEntry;
    }),
  createDepartment: protectedProcedure
    .input(departmentInputSchema)
    .mutation(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const [createdDepartment] = await ctx.db
        .insert(department)
        .values({
          description: normalizeOptionalString(input.description),
          factoryId: input.factoryId,
          id: randomUUID(),
          name: input.name,
        })
        .returning();

      if (createdDepartment === undefined) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create department.',
        });
      }

      await setObjectParentRelation(
        AUTHZ_TYPE_DEPARTMENT,
        createdDepartment.id,
        AUTHZ_TYPE_FACTORY,
        createdDepartment.factoryId,
      );

      return createdDepartment;
    }),
  createFactory: protectedProcedure.input(factoryInputSchema).mutation(async ({ input, ctx }) => {
    requireSysAdmin(ctx.user.role);

    const [createdFactory] = await ctx.db
      .insert(factory)
      .values({
        description: normalizeOptionalString(input.description),
        id: randomUUID(),
        name: input.name,
      })
      .returning();

    if (createdFactory === undefined) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create factory.',
      });
    }

    return createdFactory;
  }),
  getManagementConsole: protectedProcedure.query(async ({ ctx }) => readManagementConsoleData(ctx)),
  removeAssignment: protectedProcedure
    .input(removeAssignmentInputSchema)
    .mutation(async ({ input, ctx }) => {
      await assertUserCanManageScope(ctx, input);

      switch (input.scopeType) {
        case 'factory':
          await replaceDirectUserRelation(AUTHZ_TYPE_FACTORY, input.scopeId, input.userId, null, [
            AUTHZ_RELATION_ADMIN,
            AUTHZ_RELATION_VIEWER,
          ]);
          break;
        case 'department':
          await replaceDirectUserRelation(
            AUTHZ_TYPE_DEPARTMENT,
            input.scopeId,
            input.userId,
            null,
            [AUTHZ_RELATION_ADMIN, AUTHZ_RELATION_VIEWER],
          );
          break;
        case 'device':
          await replaceDirectUserRelation(AUTHZ_TYPE_DEVICE, input.scopeId, input.userId, null, [
            AUTHZ_RELATION_VIEWER,
          ]);
          break;
        case 'component':
          await replaceDirectUserRelation(
            AUTHZ_TYPE_DEVICE_COMPONENT,
            input.scopeId,
            input.userId,
            null,
            [AUTHZ_RELATION_READER, AUTHZ_RELATION_WRITER],
          );
          break;
      }

      return { success: true as const };
    }),
  setInstallationState: protectedProcedure
    .input(deviceComponentInstallationInputSchema)
    .mutation(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const [existingInstallation] = await ctx.db
        .select()
        .from(deviceComponentInstallation)
        .where(
          and(
            eq(deviceComponentInstallation.deviceId, input.deviceId),
            eq(deviceComponentInstallation.componentKey, input.componentKey),
          ),
        )
        .limit(1);

      if (existingInstallation === undefined) {
        const [createdInstallation] = await ctx.db
          .insert(deviceComponentInstallation)
          .values({
            componentKey: input.componentKey,
            deviceId: input.deviceId,
            enabled: input.enabled,
            id: randomUUID(),
          })
          .returning();

        if (createdInstallation === undefined) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create device app installation.',
          });
        }

        await writeAuthzTuples([
          buildComponentParentTuple(createdInstallation.id, createdInstallation.deviceId),
        ]);
        return createdInstallation;
      }

      const [updatedInstallation] = await ctx.db
        .update(deviceComponentInstallation)
        .set({
          enabled: input.enabled,
        })
        .where(eq(deviceComponentInstallation.id, existingInstallation.id))
        .returning();

      return updatedInstallation;
    }),
  updateCatalogEntry: protectedProcedure
    .input(componentCatalogInputSchema)
    .mutation(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const [updatedEntry] = await ctx.db
        .update(deviceComponentCatalog)
        .set({
          defaultEnabled: input.defaultEnabled,
          description: normalizeOptionalString(input.description),
          displayName: input.displayName,
          navigationLabel: input.navigationLabel,
          readActions: normalizeStringArray(input.readActions),
          rendererKey: normalizeOptionalString(input.rendererKey),
          routePath: normalizeOptionalString(input.routePath),
          serviceName: input.serviceName,
          sortOrder: input.sortOrder,
          writeActions: normalizeStringArray(input.writeActions),
        })
        .where(eq(deviceComponentCatalog.key, input.key))
        .returning();

      if (updatedEntry === undefined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Device app catalog entry not found.',
        });
      }

      return updatedEntry;
    }),
  updateDepartment: protectedProcedure
    .input(updateDepartmentInputSchema)
    .mutation(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const [updatedDepartment] = await ctx.db
        .update(department)
        .set({
          description: normalizeOptionalString(input.description),
          factoryId: input.factoryId,
          name: input.name,
        })
        .where(eq(department.id, input.id))
        .returning();

      if (updatedDepartment === undefined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Department not found.',
        });
      }

      await setObjectParentRelation(
        AUTHZ_TYPE_DEPARTMENT,
        updatedDepartment.id,
        AUTHZ_TYPE_FACTORY,
        updatedDepartment.factoryId,
      );

      return updatedDepartment;
    }),
  updateFactory: protectedProcedure
    .input(updateFactoryInputSchema)
    .mutation(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const [updatedFactory] = await ctx.db
        .update(factory)
        .set({
          description: normalizeOptionalString(input.description),
          name: input.name,
        })
        .where(eq(factory.id, input.id))
        .returning();

      if (updatedFactory === undefined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Factory not found.',
        });
      }

      return updatedFactory;
    }),
  upsertAssignment: protectedProcedure
    .input(assignmentInputSchema)
    .mutation(async ({ input, ctx }) => {
      await assertUserCanManageScope(ctx, input);

      switch (input.scopeType) {
        case 'factory':
          await replaceDirectUserRelation(
            AUTHZ_TYPE_FACTORY,
            input.scopeId,
            input.userId,
            input.role === 'admin' ? AUTHZ_RELATION_ADMIN : AUTHZ_RELATION_VIEWER,
            [AUTHZ_RELATION_ADMIN, AUTHZ_RELATION_VIEWER],
          );
          break;
        case 'department':
          await replaceDirectUserRelation(
            AUTHZ_TYPE_DEPARTMENT,
            input.scopeId,
            input.userId,
            input.role === 'admin' ? AUTHZ_RELATION_ADMIN : AUTHZ_RELATION_VIEWER,
            [AUTHZ_RELATION_ADMIN, AUTHZ_RELATION_VIEWER],
          );
          break;
        case 'device':
          await replaceDirectUserRelation(
            AUTHZ_TYPE_DEVICE,
            input.scopeId,
            input.userId,
            AUTHZ_RELATION_VIEWER,
            [AUTHZ_RELATION_VIEWER],
          );
          break;
        case 'component': {
          await readInstallationOrThrow(ctx.db, input.scopeId);
          await replaceDirectUserRelation(
            AUTHZ_TYPE_DEVICE_COMPONENT,
            input.scopeId,
            input.userId,
            input.accessLevel === 'write' ? AUTHZ_RELATION_WRITER : AUTHZ_RELATION_READER,
            [AUTHZ_RELATION_READER, AUTHZ_RELATION_WRITER],
          );
          break;
        }
      }

      return { success: true as const };
    }),
});
