import { TRPCError } from '@trpc/server';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import {
  departmentWorkspaceInputSchema,
  deviceWorkspaceInputSchema,
  factoryWorkspaceInputSchema,
  sysadminDirectoryInputSchema,
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
  AUTHZ_RELATION_CAN_NAVIGATE,
  AUTHZ_RELATION_CAN_READ,
  AUTHZ_RELATION_VIEWER,
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  AUTHZ_TYPE_FACTORY,
  checkUserObjectRelation,
  createAuthzObject,
  ensureAuthzState,
  getDeviceComponentAccessForUser,
  isSysAdminRole,
  listUserAuthorizedObjectIds,
  readTuplesForObject,
} from '../../../lib/authz';
import { createTRPCRouter, type Database, protectedProcedure } from '../../trpc';

type DirectAccessCounts = Readonly<{
  adminCount: number;
  userCount: number;
  viewerCount: number;
}>;

type PaginationMeta = Readonly<{
  page: number;
  pageCount: number;
  perPage: number;
  totalCount: number;
}>;

const USER_PREFIX = 'user:';
const FACTORY_NOT_FOUND_MESSAGE = 'Factory not found.';
const DEPARTMENT_NOT_FOUND_MESSAGE = 'Department not found.';
const DEVICE_NOT_FOUND_MESSAGE = 'Device not found.';

const toPaginationMeta = (page: number, perPage: number, totalCount: number): PaginationMeta => ({
  page,
  pageCount: Math.max(1, Math.ceil(totalCount / perPage)),
  perPage,
  totalCount,
});

const buildSearchPattern = (value: string): string | null => {
  const normalized = value.trim();
  return normalized === '' ? null : `%${normalized}%`;
};

const readDirectAccessCounts = async (objectName: string): Promise<DirectAccessCounts> => {
  const { client } = await ensureAuthzState();
  const tuples = await readTuplesForObject(client, objectName);

  let adminCount = 0;
  let viewerCount = 0;

  for (const tupleKey of tuples) {
    if (!tupleKey.user.startsWith(USER_PREFIX)) {
      continue;
    }

    if (tupleKey.relation === AUTHZ_RELATION_ADMIN) {
      adminCount += 1;
      continue;
    }

    if (tupleKey.relation === AUTHZ_RELATION_VIEWER) {
      viewerCount += 1;
    }
  }

  return {
    adminCount,
    userCount: adminCount + viewerCount,
    viewerCount,
  };
};

const readDirectViewerCount = async (objectName: string): Promise<number> => {
  const { client } = await ensureAuthzState();
  const tuples = await readTuplesForObject(client, objectName);

  return tuples.filter(
    (tupleKey) =>
      tupleKey.relation === AUTHZ_RELATION_VIEWER && tupleKey.user.startsWith(USER_PREFIX),
  ).length;
};

const readFactorySidebarRows = async (
  db: Database,
  factoryIds?: readonly string[],
  departmentIds?: readonly string[],
  deviceIds?: readonly string[],
) => {
  if (factoryIds?.length === 0) {
    return [];
  }

  const departmentCountExpr =
    departmentIds === undefined
      ? sql<number>`cast(count(distinct ${department.id}) as int)`
      : sql<number>`cast(count(distinct case when ${inArray(department.id, [...departmentIds])} then ${department.id} end) as int)`;
  const deviceCountExpr =
    deviceIds === undefined
      ? sql<number>`cast(count(distinct ${device.id}) as int)`
      : sql<number>`cast(count(distinct case when ${inArray(device.id, [...deviceIds])} then ${device.id} end) as int)`;

  const baseQuery = db
    .select({
      departmentCount: departmentCountExpr,
      description: factory.description,
      deviceCount: deviceCountExpr,
      id: factory.id,
      name: factory.name,
    })
    .from(factory)
    .leftJoin(department, eq(department.factoryId, factory.id))
    .leftJoin(device, eq(device.departmentId, department.id));

  return factoryIds === undefined
    ? baseQuery.groupBy(factory.id).orderBy(asc(factory.name))
    : baseQuery
        .where(inArray(factory.id, [...factoryIds]))
        .groupBy(factory.id)
        .orderBy(asc(factory.name));
};

const readDepartmentSidebarRows = async (
  db: Database,
  factoryId: string,
  departmentIds?: readonly string[],
  deviceIds?: readonly string[],
) => {
  if (departmentIds?.length === 0) {
    return [];
  }

  const deviceCountExpr =
    deviceIds === undefined
      ? sql<number>`cast(count(distinct ${device.id}) as int)`
      : sql<number>`cast(count(distinct case when ${inArray(device.id, [...deviceIds])} then ${device.id} end) as int)`;
  const activeDeviceCountExpr =
    deviceIds === undefined
      ? sql<number>`cast(count(distinct case when ${device.isActive} then ${device.id} end) as int)`
      : sql<number>`cast(count(distinct case when ${device.isActive} and ${inArray(device.id, [...deviceIds])} then ${device.id} end) as int)`;

  const conditions = [eq(department.factoryId, factoryId)];
  if (departmentIds !== undefined) {
    conditions.push(inArray(department.id, [...departmentIds]));
  }

  return db
    .select({
      activeDeviceCount: activeDeviceCountExpr,
      description: department.description,
      deviceCount: deviceCountExpr,
      factoryId: department.factoryId,
      id: department.id,
      name: department.name,
    })
    .from(department)
    .leftJoin(device, eq(device.departmentId, department.id))
    .where(and(...conditions))
    .groupBy(department.id)
    .orderBy(asc(department.name));
};

const readDeviceSidebarRows = async (
  db: Database,
  departmentId: string,
  deviceIds?: readonly string[],
  componentIds?: readonly string[],
) => {
  if (deviceIds?.length === 0) {
    return [];
  }

  const enabledAppCountExpr =
    componentIds === undefined
      ? sql<number>`cast(count(case when ${deviceComponentInstallation.enabled} then 1 end) as int)`
      : sql<number>`cast(count(case when ${deviceComponentInstallation.enabled} and ${inArray(deviceComponentInstallation.id, [...componentIds])} then 1 end) as int)`;
  const totalAppCountExpr =
    componentIds === undefined
      ? sql<number>`cast(count(${deviceComponentInstallation.id}) as int)`
      : sql<number>`cast(count(case when ${inArray(deviceComponentInstallation.id, [...componentIds])} then ${deviceComponentInstallation.id} end) as int)`;

  const conditions = [eq(device.departmentId, departmentId)];
  if (deviceIds !== undefined) {
    conditions.push(inArray(device.id, [...deviceIds]));
  }

  return db
    .select({
      departmentId: device.departmentId,
      description: device.description,
      enabledAppCount: enabledAppCountExpr,
      id: device.id,
      isActive: device.isActive,
      name: device.name,
      totalAppCount: totalAppCountExpr,
    })
    .from(device)
    .leftJoin(deviceComponentInstallation, eq(deviceComponentInstallation.deviceId, device.id))
    .where(and(...conditions))
    .groupBy(device.id)
    .orderBy(asc(device.name));
};

const requireSysadmin = (role: string | null | undefined) => {
  if (!isSysAdminRole(role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only sysadmins can access this panel.',
    });
  }
};

const requireNavigableFactory = async (
  userId: string,
  role: string | null | undefined,
  factoryId: string,
) => {
  if (isSysAdminRole(role)) {
    return;
  }

  const allowed = await checkUserObjectRelation(
    userId,
    AUTHZ_RELATION_CAN_NAVIGATE,
    AUTHZ_TYPE_FACTORY,
    factoryId,
  );

  if (!allowed) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this factory.',
    });
  }
};

const requireNavigableDepartment = async (
  userId: string,
  role: string | null | undefined,
  departmentId: string,
) => {
  if (isSysAdminRole(role)) {
    return;
  }

  const allowed = await checkUserObjectRelation(
    userId,
    AUTHZ_RELATION_CAN_NAVIGATE,
    AUTHZ_TYPE_DEPARTMENT,
    departmentId,
  );

  if (!allowed) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this department.',
    });
  }
};

const resolveNavigableFactoryIds = async (
  userId: string,
  role: string | null | undefined,
): Promise<string[] | undefined> => {
  if (isSysAdminRole(role)) {
    return undefined;
  }

  return Array.from(
    await listUserAuthorizedObjectIds(userId, AUTHZ_RELATION_CAN_NAVIGATE, AUTHZ_TYPE_FACTORY),
  );
};

const getFactoryWorkspace = protectedProcedure
  .input(factoryWorkspaceInputSchema)
  .query(async ({ input, ctx }) => {
    await requireNavigableFactory(ctx.user.id, ctx.user.role, input.factoryId);

    const sysadmin = isSysAdminRole(ctx.user.role);
    const searchPattern = buildSearchPattern(input.name);
    const navigableFactoryIds = await resolveNavigableFactoryIds(ctx.user.id, ctx.user.role);

    const [navigableDepartmentIds, readableDepartmentIds, navigableDeviceIds] = sysadmin
      ? [undefined, undefined, undefined]
      : await Promise.all([
          listUserAuthorizedObjectIds(
            ctx.user.id,
            AUTHZ_RELATION_CAN_NAVIGATE,
            AUTHZ_TYPE_DEPARTMENT,
          ).then((ids) => Array.from(ids)),
          listUserAuthorizedObjectIds(
            ctx.user.id,
            AUTHZ_RELATION_CAN_READ,
            AUTHZ_TYPE_DEPARTMENT,
          ).then((ids) => Array.from(ids)),
          listUserAuthorizedObjectIds(
            ctx.user.id,
            AUTHZ_RELATION_CAN_NAVIGATE,
            AUTHZ_TYPE_DEVICE,
          ).then((ids) => Array.from(ids)),
        ]);

    const [selectedFactory, factories] = await Promise.all([
      ctx.db.select().from(factory).where(eq(factory.id, input.factoryId)).limit(1),
      readFactorySidebarRows(
        ctx.db,
        navigableFactoryIds,
        navigableDepartmentIds,
        navigableDeviceIds,
      ),
    ]);

    const currentFactory = selectedFactory[0];
    if (currentFactory === undefined) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: FACTORY_NOT_FOUND_MESSAGE,
      });
    }

    const canReadSelectedFactory = sysadmin
      ? true
      : await checkUserObjectRelation(
          ctx.user.id,
          AUTHZ_RELATION_CAN_READ,
          AUTHZ_TYPE_FACTORY,
          input.factoryId,
        );

    const scopedDepartmentConditions = [eq(department.factoryId, input.factoryId)];
    if (!canReadSelectedFactory && !sysadmin) {
      if (navigableDepartmentIds?.length === 0) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this factory.',
        });
      }

      scopedDepartmentConditions.push(inArray(department.id, navigableDepartmentIds ?? []));
    }

    const totalConditions = [...scopedDepartmentConditions];
    if (searchPattern !== null) {
      const searchCondition = or(
        ilike(department.name, searchPattern),
        ilike(department.description, searchPattern),
      );
      if (searchCondition !== undefined) {
        totalConditions.push(searchCondition);
      }
    }

    const totalCountRows = await ctx.db
      .select({
        totalCount: sql<number>`cast(count(*) as int)`,
      })
      .from(department)
      .where(and(...totalConditions));
    const totalCount = totalCountRows[0]?.totalCount ?? 0;

    const deviceCountExpr =
      canReadSelectedFactory || sysadmin || navigableDeviceIds === undefined
        ? sql<number>`cast(count(distinct ${device.id}) as int)`
        : sql<number>`cast(count(distinct case when ${inArray(device.id, navigableDeviceIds)} then ${device.id} end) as int)`;
    const activeDeviceCountExpr =
      canReadSelectedFactory || sysadmin || navigableDeviceIds === undefined
        ? sql<number>`cast(count(distinct case when ${device.isActive} then ${device.id} end) as int)`
        : sql<number>`cast(count(distinct case when ${device.isActive} and ${inArray(device.id, navigableDeviceIds)} then ${device.id} end) as int)`;

    const departmentRows = await ctx.db
      .select({
        activeDeviceCount: activeDeviceCountExpr,
        description: department.description,
        deviceCount: deviceCountExpr,
        id: department.id,
        name: department.name,
        updatedAt: department.updatedAt,
      })
      .from(department)
      .leftJoin(device, eq(device.departmentId, department.id))
      .where(and(...totalConditions))
      .groupBy(department.id)
      .orderBy(asc(department.name))
      .limit(input.perPage)
      .offset((input.page - 1) * input.perPage);

    const [scopeCounts, departmentAccessCounts, summaryCounts] = await Promise.all([
      readDirectAccessCounts(createAuthzObject(AUTHZ_TYPE_FACTORY, input.factoryId)),
      Promise.all(
        departmentRows.map(async (departmentRow) => ({
          counts: await readDirectAccessCounts(
            createAuthzObject(AUTHZ_TYPE_DEPARTMENT, departmentRow.id),
          ),
          departmentId: departmentRow.id,
        })),
      ),
      Promise.all([
        ctx.db
          .select({
            count: sql<number>`cast(count(*) as int)`,
          })
          .from(department)
          .where(and(...scopedDepartmentConditions)),
        ctx.db
          .select({
            count: sql<number>`cast(count(*) as int)`,
          })
          .from(device)
          .innerJoin(department, eq(department.id, device.departmentId))
          .where(
            and(
              ...scopedDepartmentConditions,
              canReadSelectedFactory || sysadmin || navigableDeviceIds === undefined
                ? undefined
                : inArray(device.id, navigableDeviceIds),
            ),
          ),
        ctx.db
          .select({
            count: sql<number>`cast(count(*) as int)`,
          })
          .from(device)
          .innerJoin(department, eq(department.id, device.departmentId))
          .where(
            and(
              ...scopedDepartmentConditions,
              eq(device.isActive, true),
              canReadSelectedFactory || sysadmin || navigableDeviceIds === undefined
                ? undefined
                : inArray(device.id, navigableDeviceIds),
            ),
          ),
      ]),
    ]);

    const accessCountByDepartmentId = new Map(
      departmentAccessCounts.map((entry) => [entry.departmentId, entry.counts]),
    );

    return {
      factories,
      isSysadmin: sysadmin,
      selectedFactory: currentFactory,
      stats: {
        activeDeviceCount: summaryCounts[2][0]?.count ?? 0,
        departmentCount: summaryCounts[0][0]?.count ?? 0,
        deviceCount: summaryCounts[1][0]?.count ?? 0,
        directAdminCount: canReadSelectedFactory ? scopeCounts.adminCount : 0,
        directUserCount: canReadSelectedFactory ? scopeCounts.userCount : 0,
      },
      table: {
        ...toPaginationMeta(input.page, input.perPage, totalCount),
        rows: departmentRows.map((departmentRow) => {
          const accessCounts = accessCountByDepartmentId.get(departmentRow.id) ?? {
            adminCount: 0,
            userCount: 0,
            viewerCount: 0,
          };
          const canReadDepartment =
            canReadSelectedFactory ||
            sysadmin ||
            readableDepartmentIds?.includes(departmentRow.id) === true;

          return {
            activeDeviceCount: departmentRow.activeDeviceCount,
            description: departmentRow.description,
            deviceCount: departmentRow.deviceCount,
            directAdminCount: canReadDepartment ? accessCounts.adminCount : 0,
            directUserCount: canReadDepartment ? accessCounts.userCount : 0,
            id: departmentRow.id,
            name: departmentRow.name,
            updatedAt: departmentRow.updatedAt,
          };
        }),
      },
    };
  });

const getDepartmentWorkspace = protectedProcedure
  .input(departmentWorkspaceInputSchema)
  .query(async ({ input, ctx }) => {
    await requireNavigableDepartment(ctx.user.id, ctx.user.role, input.departmentId);

    const sysadmin = isSysAdminRole(ctx.user.role);
    const searchPattern = buildSearchPattern(input.name);

    const [selectedDepartmentRow] = await ctx.db
      .select({
        departmentDescription: department.description,
        departmentId: department.id,
        departmentName: department.name,
        factoryId: factory.id,
        factoryName: factory.name,
      })
      .from(department)
      .innerJoin(factory, eq(factory.id, department.factoryId))
      .where(eq(department.id, input.departmentId))
      .limit(1);

    if (selectedDepartmentRow === undefined) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: DEPARTMENT_NOT_FOUND_MESSAGE,
      });
    }

    const canReadSelectedDepartment = sysadmin
      ? true
      : await checkUserObjectRelation(
          ctx.user.id,
          AUTHZ_RELATION_CAN_READ,
          AUTHZ_TYPE_DEPARTMENT,
          input.departmentId,
        );

    const [navigableDepartmentIds, navigableDeviceIds, readableDeviceIds, readableComponentIds] =
      sysadmin
        ? [undefined, undefined, undefined, undefined]
        : await Promise.all([
            listUserAuthorizedObjectIds(
              ctx.user.id,
              AUTHZ_RELATION_CAN_NAVIGATE,
              AUTHZ_TYPE_DEPARTMENT,
            ).then((ids) => Array.from(ids)),
            listUserAuthorizedObjectIds(
              ctx.user.id,
              AUTHZ_RELATION_CAN_NAVIGATE,
              AUTHZ_TYPE_DEVICE,
            ).then((ids) => Array.from(ids)),
            listUserAuthorizedObjectIds(
              ctx.user.id,
              AUTHZ_RELATION_CAN_READ,
              AUTHZ_TYPE_DEVICE,
            ).then((ids) => Array.from(ids)),
            listUserAuthorizedObjectIds(
              ctx.user.id,
              AUTHZ_RELATION_CAN_READ,
              AUTHZ_TYPE_DEVICE_COMPONENT,
            ).then((ids) => Array.from(ids)),
          ]);

    const scopedDeviceConditions = [eq(device.departmentId, input.departmentId)];
    if (!canReadSelectedDepartment && !sysadmin) {
      if (navigableDeviceIds?.length === 0) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this department.',
        });
      }

      scopedDeviceConditions.push(inArray(device.id, navigableDeviceIds ?? []));
    }

    const canReadParentFactory = sysadmin
      ? true
      : await checkUserObjectRelation(
          ctx.user.id,
          AUTHZ_RELATION_CAN_READ,
          AUTHZ_TYPE_FACTORY,
          selectedDepartmentRow.factoryId,
        );

    const visibleDepartmentIds =
      canReadParentFactory || sysadmin ? undefined : navigableDepartmentIds;

    const [
      departments,
      totalDevicesRow,
      activeDevicesRow,
      enabledAppsRow,
      totalCountRow,
      deviceRows,
    ] = await Promise.all([
      readDepartmentSidebarRows(
        ctx.db,
        selectedDepartmentRow.factoryId,
        visibleDepartmentIds,
        navigableDeviceIds,
      ),
      ctx.db
        .select({
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(device)
        .where(and(...scopedDeviceConditions)),
      ctx.db
        .select({
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(device)
        .where(and(...scopedDeviceConditions, eq(device.isActive, true))),
      ctx.db
        .select({
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(deviceComponentInstallation)
        .innerJoin(device, eq(device.id, deviceComponentInstallation.deviceId))
        .where(
          and(
            ...scopedDeviceConditions,
            eq(deviceComponentInstallation.enabled, true),
            canReadSelectedDepartment || sysadmin || readableComponentIds === undefined
              ? undefined
              : inArray(deviceComponentInstallation.id, readableComponentIds),
          ),
        ),
      ctx.db
        .select({
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(device)
        .where(
          and(
            ...scopedDeviceConditions,
            searchPattern === null
              ? undefined
              : or(ilike(device.name, searchPattern), ilike(device.description, searchPattern)),
          ),
        ),
      ctx.db
        .select({
          description: device.description,
          enabledAppCount:
            canReadSelectedDepartment || sysadmin || readableComponentIds === undefined
              ? sql<number>`cast(count(case when ${deviceComponentInstallation.enabled} then 1 end) as int)`
              : sql<number>`cast(count(case when ${deviceComponentInstallation.enabled} and ${inArray(deviceComponentInstallation.id, readableComponentIds)} then 1 end) as int)`,
          id: device.id,
          isActive: device.isActive,
          name: device.name,
          totalAppCount:
            canReadSelectedDepartment || sysadmin || readableComponentIds === undefined
              ? sql<number>`cast(count(${deviceComponentInstallation.id}) as int)`
              : sql<number>`cast(count(case when ${inArray(deviceComponentInstallation.id, readableComponentIds)} then ${deviceComponentInstallation.id} end) as int)`,
          updatedAt: device.updatedAt,
        })
        .from(device)
        .leftJoin(deviceComponentInstallation, eq(deviceComponentInstallation.deviceId, device.id))
        .where(
          and(
            ...scopedDeviceConditions,
            searchPattern === null
              ? undefined
              : or(ilike(device.name, searchPattern), ilike(device.description, searchPattern)),
          ),
        )
        .groupBy(device.id)
        .orderBy(asc(device.name))
        .limit(input.perPage)
        .offset((input.page - 1) * input.perPage),
    ]);

    const [scopeCounts, deviceViewerCounts] = await Promise.all([
      readDirectAccessCounts(createAuthzObject(AUTHZ_TYPE_DEPARTMENT, input.departmentId)),
      Promise.all(
        deviceRows.map(async (deviceRow) => ({
          deviceId: deviceRow.id,
          viewerCount: await readDirectViewerCount(
            createAuthzObject(AUTHZ_TYPE_DEVICE, deviceRow.id),
          ),
        })),
      ),
    ]);

    const viewerCountByDeviceId = new Map(
      deviceViewerCounts.map((entry) => [entry.deviceId, entry.viewerCount]),
    );

    return {
      departments,
      isSysadmin: sysadmin,
      selectedDepartment: {
        description: selectedDepartmentRow.departmentDescription,
        factoryId: selectedDepartmentRow.factoryId,
        factoryName: selectedDepartmentRow.factoryName,
        id: selectedDepartmentRow.departmentId,
        name: selectedDepartmentRow.departmentName,
      },
      stats: {
        activeDeviceCount: activeDevicesRow[0]?.count ?? 0,
        deviceCount: totalDevicesRow[0]?.count ?? 0,
        directAdminCount: canReadSelectedDepartment ? scopeCounts.adminCount : 0,
        directUserCount: canReadSelectedDepartment ? scopeCounts.userCount : 0,
        enabledAppCount: enabledAppsRow[0]?.count ?? 0,
      },
      table: {
        ...toPaginationMeta(input.page, input.perPage, totalCountRow[0]?.count ?? 0),
        rows: deviceRows.map((deviceRow) => ({
          description: deviceRow.description,
          directUserCount:
            canReadSelectedDepartment ||
            sysadmin ||
            readableDeviceIds?.includes(deviceRow.id) === true
              ? (viewerCountByDeviceId.get(deviceRow.id) ?? 0)
              : 0,
          enabledAppCount: deviceRow.enabledAppCount,
          id: deviceRow.id,
          isActive: deviceRow.isActive,
          name: deviceRow.name,
          totalAppCount: deviceRow.totalAppCount,
          updatedAt: deviceRow.updatedAt,
        })),
      },
    };
  });

const getDeviceWorkspace = protectedProcedure
  .input(deviceWorkspaceInputSchema)
  .query(async ({ input, ctx }) => {
    const [selectedDeviceRow] = await ctx.db
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
      .where(eq(device.id, input.deviceId))
      .limit(1);

    if (selectedDeviceRow === undefined) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: DEVICE_NOT_FOUND_MESSAGE,
      });
    }

    const sysadmin = isSysAdminRole(ctx.user.role);

    let access;
    try {
      access = await getDeviceComponentAccessForUser(ctx.db, ctx.user.id, input.deviceId, sysadmin);
    } catch (error) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: error instanceof Error ? error.message : 'You do not have access to this device.',
      });
    }

    const canReadSelectedDevice = sysadmin
      ? true
      : await checkUserObjectRelation(
          ctx.user.id,
          AUTHZ_RELATION_CAN_READ,
          AUTHZ_TYPE_DEVICE,
          input.deviceId,
        );

    const canReadParentDepartment = sysadmin
      ? true
      : await checkUserObjectRelation(
          ctx.user.id,
          AUTHZ_RELATION_CAN_READ,
          AUTHZ_TYPE_DEPARTMENT,
          selectedDeviceRow.departmentId,
        );

    const readableComponentIds =
      canReadSelectedDevice || sysadmin
        ? undefined
        : access.components.map((component) => component.id);

    const visibleDeviceIds =
      canReadParentDepartment || sysadmin
        ? undefined
        : Array.from(
            await listUserAuthorizedObjectIds(
              ctx.user.id,
              AUTHZ_RELATION_CAN_NAVIGATE,
              AUTHZ_TYPE_DEVICE,
            ),
          );

    const [devices, totalAppsRow, enabledAppsRow, directViewerCount] = await Promise.all([
      readDeviceSidebarRows(
        ctx.db,
        selectedDeviceRow.departmentId,
        visibleDeviceIds,
        readableComponentIds,
      ),
      ctx.db
        .select({
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(deviceComponentInstallation)
        .where(
          and(
            eq(deviceComponentInstallation.deviceId, input.deviceId),
            canReadSelectedDevice
              ? undefined
              : inArray(deviceComponentInstallation.id, readableComponentIds ?? []),
          ),
        ),
      ctx.db
        .select({
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(deviceComponentInstallation)
        .where(
          and(
            eq(deviceComponentInstallation.deviceId, input.deviceId),
            canReadSelectedDevice
              ? undefined
              : inArray(deviceComponentInstallation.id, readableComponentIds ?? []),
            eq(deviceComponentInstallation.enabled, true),
          ),
        ),
      readDirectViewerCount(createAuthzObject(AUTHZ_TYPE_DEVICE, input.deviceId)),
    ]);

    return {
      canManageUsers: access.canManageUsers,
      components: access.components,
      device: {
        ...selectedDeviceRow,
        accessToken: sysadmin ? selectedDeviceRow.accessToken : null,
        canManageUsers: access.canManageUsers,
      },
      devices,
      gatewayAccessToken: access.gatewayAccessToken,
      isSysadmin: sysadmin,
      stats: {
        directUserCount: canReadSelectedDevice ? directViewerCount : 0,
        enabledAppCount: enabledAppsRow[0]?.count ?? 0,
        totalAppCount: totalAppsRow[0]?.count ?? 0,
        visibleAppCount: access.components.length,
      },
    };
  });

const listSysadminFactories = protectedProcedure
  .input(sysadminDirectoryInputSchema)
  .query(async ({ input, ctx }) => {
    requireSysadmin(ctx.user.role);

    const searchPattern = buildSearchPattern(input.name);
    const whereClause =
      searchPattern === null
        ? undefined
        : or(ilike(factory.name, searchPattern), ilike(factory.description, searchPattern));

    const totalCountRows = await ctx.db
      .select({ totalCount: sql<number>`cast(count(*) as int)` })
      .from(factory)
      .where(whereClause);
    const totalCount = totalCountRows[0]?.totalCount ?? 0;

    const rows = await readFactorySidebarRows(
      ctx.db,
      (
        await ctx.db
          .select({ id: factory.id })
          .from(factory)
          .where(whereClause)
          .orderBy(asc(factory.name))
          .limit(input.perPage)
          .offset((input.page - 1) * input.perPage)
      ).map((row) => row.id),
    );

    const [departmentCount, deviceCount] = await Promise.all([
      ctx.db.select({ count: sql<number>`cast(count(*) as int)` }).from(department),
      ctx.db.select({ count: sql<number>`cast(count(*) as int)` }).from(device),
    ]);

    return {
      stats: {
        departmentCount: departmentCount[0]?.count ?? 0,
        deviceCount: deviceCount[0]?.count ?? 0,
        factoryCount: totalCount,
      },
      table: {
        ...toPaginationMeta(input.page, input.perPage, totalCount),
        rows,
      },
    };
  });

const listSysadminDepartments = protectedProcedure
  .input(sysadminDirectoryInputSchema)
  .query(async ({ input, ctx }) => {
    requireSysadmin(ctx.user.role);

    const searchPattern = buildSearchPattern(input.name);
    const whereClause =
      searchPattern === null
        ? undefined
        : or(ilike(department.name, searchPattern), ilike(department.description, searchPattern));

    const totalCountRows = await ctx.db
      .select({ totalCount: sql<number>`cast(count(*) as int)` })
      .from(department)
      .where(whereClause);
    const totalCount = totalCountRows[0]?.totalCount ?? 0;

    const rows = await ctx.db
      .select({
        activeDeviceCount: sql<number>`cast(count(distinct case when ${device.isActive} then ${device.id} end) as int)`,
        description: department.description,
        deviceCount: sql<number>`cast(count(distinct ${device.id}) as int)`,
        factoryId: factory.id,
        factoryName: factory.name,
        id: department.id,
        name: department.name,
        updatedAt: department.updatedAt,
      })
      .from(department)
      .innerJoin(factory, eq(factory.id, department.factoryId))
      .leftJoin(device, eq(device.departmentId, department.id))
      .where(whereClause)
      .groupBy(department.id, factory.id)
      .orderBy(asc(factory.name), asc(department.name))
      .limit(input.perPage)
      .offset((input.page - 1) * input.perPage);

    const [deviceCount, activeDeviceCount] = await Promise.all([
      ctx.db.select({ count: sql<number>`cast(count(*) as int)` }).from(device),
      ctx.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(device)
        .where(eq(device.isActive, true)),
    ]);

    return {
      stats: {
        activeDeviceCount: activeDeviceCount[0]?.count ?? 0,
        departmentCount: totalCount,
        deviceCount: deviceCount[0]?.count ?? 0,
      },
      table: {
        ...toPaginationMeta(input.page, input.perPage, totalCount),
        rows,
      },
    };
  });

const listSysadminDevices = protectedProcedure
  .input(sysadminDirectoryInputSchema)
  .query(async ({ input, ctx }) => {
    requireSysadmin(ctx.user.role);

    const searchPattern = buildSearchPattern(input.name);
    const whereClause =
      searchPattern === null
        ? undefined
        : or(ilike(device.name, searchPattern), ilike(device.description, searchPattern));

    const totalCountRows = await ctx.db
      .select({ totalCount: sql<number>`cast(count(*) as int)` })
      .from(device)
      .where(whereClause);
    const totalCount = totalCountRows[0]?.totalCount ?? 0;

    const rows = await ctx.db
      .select({
        accessToken: device.accessToken,
        createdAt: device.createdAt,
        departmentId: department.id,
        departmentName: department.name,
        description: device.description,
        enabledAppCount: sql<number>`cast(count(case when ${deviceComponentInstallation.enabled} then 1 end) as int)`,
        factoryId: factory.id,
        factoryName: factory.name,
        id: device.id,
        isActive: device.isActive,
        name: device.name,
        totalAppCount: sql<number>`cast(count(${deviceComponentInstallation.id}) as int)`,
        updatedAt: device.updatedAt,
      })
      .from(device)
      .innerJoin(department, eq(department.id, device.departmentId))
      .innerJoin(factory, eq(factory.id, department.factoryId))
      .leftJoin(deviceComponentInstallation, eq(deviceComponentInstallation.deviceId, device.id))
      .where(whereClause)
      .groupBy(device.id, department.id, factory.id)
      .orderBy(asc(factory.name), asc(department.name), asc(device.name))
      .limit(input.perPage)
      .offset((input.page - 1) * input.perPage);

    const [activeDeviceCount, enabledAppCount] = await Promise.all([
      ctx.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(device)
        .where(eq(device.isActive, true)),
      ctx.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(deviceComponentInstallation)
        .where(eq(deviceComponentInstallation.enabled, true)),
    ]);

    return {
      stats: {
        activeDeviceCount: activeDeviceCount[0]?.count ?? 0,
        deviceCount: totalCount,
        enabledAppCount: enabledAppCount[0]?.count ?? 0,
      },
      table: {
        ...toPaginationMeta(input.page, input.perPage, totalCount),
        rows,
      },
    };
  });

const listSysadminApps = protectedProcedure
  .input(sysadminDirectoryInputSchema)
  .query(async ({ input, ctx }) => {
    requireSysadmin(ctx.user.role);

    const searchPattern = buildSearchPattern(input.name);
    const whereClause =
      searchPattern === null
        ? undefined
        : or(
            ilike(deviceComponentCatalog.displayName, searchPattern),
            ilike(deviceComponentCatalog.key, searchPattern),
            ilike(deviceComponentCatalog.serviceName, searchPattern),
          );

    const totalCountRows = await ctx.db
      .select({ totalCount: sql<number>`cast(count(*) as int)` })
      .from(deviceComponentCatalog)
      .where(whereClause);
    const totalCount = totalCountRows[0]?.totalCount ?? 0;

    const rows = await ctx.db
      .select({
        defaultEnabled: deviceComponentCatalog.defaultEnabled,
        description: deviceComponentCatalog.description,
        displayName: deviceComponentCatalog.displayName,
        enabledInstallCount: sql<number>`cast(count(case when ${deviceComponentInstallation.enabled} then 1 end) as int)`,
        id: deviceComponentCatalog.key,
        installCount: sql<number>`cast(count(${deviceComponentInstallation.id}) as int)`,
        key: deviceComponentCatalog.key,
        navigationLabel: deviceComponentCatalog.navigationLabel,
        readActions: deviceComponentCatalog.readActions,
        rendererKey: deviceComponentCatalog.rendererKey,
        routePath: deviceComponentCatalog.routePath,
        serviceName: deviceComponentCatalog.serviceName,
        sortOrder: deviceComponentCatalog.sortOrder,
        writeActions: deviceComponentCatalog.writeActions,
      })
      .from(deviceComponentCatalog)
      .leftJoin(
        deviceComponentInstallation,
        eq(deviceComponentInstallation.componentKey, deviceComponentCatalog.key),
      )
      .where(whereClause)
      .groupBy(deviceComponentCatalog.key)
      .orderBy(asc(deviceComponentCatalog.sortOrder), asc(deviceComponentCatalog.displayName))
      .limit(input.perPage)
      .offset((input.page - 1) * input.perPage);

    const [installationsCount, enabledInstallationsCount] = await Promise.all([
      ctx.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(deviceComponentInstallation),
      ctx.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(deviceComponentInstallation)
        .where(eq(deviceComponentInstallation.enabled, true)),
    ]);

    return {
      stats: {
        appCount: totalCount,
        enabledInstallationsCount: enabledInstallationsCount[0]?.count ?? 0,
        installationsCount: installationsCount[0]?.count ?? 0,
      },
      table: {
        ...toPaginationMeta(input.page, input.perPage, totalCount),
        rows,
      },
    };
  });

export const workspaceRouter = createTRPCRouter({
  getDepartmentWorkspace,
  getDeviceWorkspace,
  getFactoryWorkspace,
  listDepartmentOptions: protectedProcedure.query(async ({ ctx }) => {
    requireSysadmin(ctx.user.role);

    return ctx.db
      .select({
        factoryId: factory.id,
        factoryName: factory.name,
        id: department.id,
        name: department.name,
      })
      .from(department)
      .innerJoin(factory, eq(factory.id, department.factoryId))
      .orderBy(asc(factory.name), asc(department.name));
  }),
  listFactoriesNav: protectedProcedure.query(async ({ ctx }) => {
    if (isSysAdminRole(ctx.user.role)) {
      return readFactorySidebarRows(ctx.db);
    }

    const [navigableFactoryIds, navigableDepartmentIds, navigableDeviceIds] = await Promise.all([
      resolveNavigableFactoryIds(ctx.user.id, ctx.user.role),
      listUserAuthorizedObjectIds(
        ctx.user.id,
        AUTHZ_RELATION_CAN_NAVIGATE,
        AUTHZ_TYPE_DEPARTMENT,
      ).then((ids) => Array.from(ids)),
      listUserAuthorizedObjectIds(ctx.user.id, AUTHZ_RELATION_CAN_NAVIGATE, AUTHZ_TYPE_DEVICE).then(
        (ids) => Array.from(ids),
      ),
    ]);

    return readFactorySidebarRows(
      ctx.db,
      navigableFactoryIds,
      navigableDepartmentIds,
      navigableDeviceIds,
    );
  }),
  listSysadminApps,
  listSysadminDepartments,
  listSysadminDevices,
  listSysadminFactories,
});
