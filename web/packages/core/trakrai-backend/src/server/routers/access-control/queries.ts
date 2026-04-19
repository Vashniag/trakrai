import { TRPCError } from '@trpc/server';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import { assertUserCanManageScope, requireSysAdmin } from './helpers';
import {
  accessControlPageInputSchema,
  accessControlScopeQueryInputSchema,
  accessControlUserSearchInputSchema,
} from './schemas';

import { user } from '../../../db/auth-schema';
import {
  department,
  device,
  deviceComponentCatalog,
  deviceComponentInstallation,
  factory,
} from '../../../db/schema';
import {
  AUTHZ_RELATION_ADMIN,
  AUTHZ_RELATION_CAN_MANAGE_USERS,
  AUTHZ_RELATION_READER,
  AUTHZ_RELATION_VIEWER,
  AUTHZ_RELATION_WRITER,
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  AUTHZ_TYPE_FACTORY,
  createAuthzObject,
  ensureAuthzState,
  isSysAdminRole,
  listUserAuthorizedObjectIds,
  parseAuthzUserId,
  readTuplesForObject,
  type AuthzDirectUserRelation,
} from '../../../lib/authz';
import { protectedProcedure } from '../../trpc';

type AccessControlNavigation = Readonly<{
  defaultHref: string;
  isSysadmin: boolean;
  showApps: boolean;
  showDepartments: boolean;
  showDevices: boolean;
  showFactories: boolean;
  showUsers: boolean;
}>;

type ManagementAccessContext = Readonly<{
  manageableDepartmentIds: string[];
  manageableFactoryIds: string[];
  navigation: AccessControlNavigation;
}>;

type PaginationMeta = Readonly<{
  page: number;
  pageCount: number;
  perPage: number;
  totalCount: number;
}>;

type DirectAssignmentEntry<TRelation extends string = string> = Readonly<{
  relation: TRelation;
  userId: string;
}>;

const FORBIDDEN_MESSAGE = 'You do not have access to advanced permissions.';

const buildSearchPattern = (value: string): string | null => {
  const normalized = value.trim();
  return normalized === '' ? null : `%${normalized}%`;
};

const toPaginationMeta = (page: number, perPage: number, totalCount: number): PaginationMeta => ({
  page,
  pageCount: Math.max(1, Math.ceil(totalCount / perPage)),
  perPage,
  totalCount,
});

const buildNavigation = (
  isSysadmin: boolean,
  manageableFactoryIds: readonly string[],
  manageableDepartmentIds: readonly string[],
): AccessControlNavigation => {
  const showUsers = isSysadmin;
  const showFactories = isSysadmin || manageableFactoryIds.length > 0;
  const showScopedTabs =
    isSysadmin || manageableFactoryIds.length > 0 || manageableDepartmentIds.length > 0;

  if (showFactories) {
    return {
      defaultHref: '/access-control/factories',
      isSysadmin,
      showApps: showScopedTabs,
      showDepartments: showScopedTabs,
      showDevices: showScopedTabs,
      showFactories,
      showUsers,
    };
  }

  if (showScopedTabs) {
    return {
      defaultHref: '/access-control/departments',
      isSysadmin,
      showApps: true,
      showDepartments: true,
      showDevices: true,
      showFactories: false,
      showUsers,
    };
  }

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: FORBIDDEN_MESSAGE,
  });
};

const readManagementAccessContext = async (
  userId: string,
  role: string | null | undefined,
): Promise<ManagementAccessContext> => {
  if (isSysAdminRole(role)) {
    return {
      manageableDepartmentIds: [],
      manageableFactoryIds: [],
      navigation: buildNavigation(true, [], []),
    };
  }

  const [factoryIds, departmentIds] = await Promise.all([
    listUserAuthorizedObjectIds(userId, AUTHZ_RELATION_CAN_MANAGE_USERS, AUTHZ_TYPE_FACTORY),
    listUserAuthorizedObjectIds(userId, AUTHZ_RELATION_CAN_MANAGE_USERS, AUTHZ_TYPE_DEPARTMENT),
  ]);

  const manageableFactoryIds = Array.from(factoryIds);
  const manageableDepartmentIds = Array.from(departmentIds);

  return {
    manageableDepartmentIds,
    manageableFactoryIds,
    navigation: buildNavigation(false, manageableFactoryIds, manageableDepartmentIds),
  };
};

const readDirectUserAssignments = async <TRelation extends AuthzDirectUserRelation>(
  objectName: string,
  relations: readonly TRelation[],
): Promise<DirectAssignmentEntry<TRelation>[]> => {
  const { client } = await ensureAuthzState();
  const tuples = await readTuplesForObject(client, objectName);

  return tuples.flatMap((tuple) => {
    const userId = parseAuthzUserId(tuple.user);
    if (userId === null) {
      return [];
    }

    if (!relations.some((relation) => relation === tuple.relation)) {
      return [];
    }

    return [
      {
        relation: tuple.relation as TRelation,
        userId,
      },
    ];
  });
};

const countAssignmentsByRelation = <TRelation extends string>(
  assignments: readonly DirectAssignmentEntry<TRelation>[],
): Map<TRelation, number> => {
  const counts = new Map<TRelation, number>();

  for (const assignment of assignments) {
    counts.set(assignment.relation, (counts.get(assignment.relation) ?? 0) + 1);
  }

  return counts;
};

const readScopeAssignmentRows = async <TRelation extends AuthzDirectUserRelation>(
  scopeObject: string,
  relations: readonly TRelation[],
  mapRelation: (relation: TRelation) => 'admin' | 'read' | 'viewer' | 'write',
  selectUsers: (userIds: readonly string[]) => Promise<
    Array<{
      email: string;
      id: string;
      name: string;
    }>
  >,
) => {
  const assignments = await readDirectUserAssignments(scopeObject, relations);
  if (assignments.length === 0) {
    return [];
  }

  const userIds = Array.from(new Set(assignments.map((assignment) => assignment.userId)));
  const userRows = await selectUsers(userIds);
  const usersById = new Map(userRows.map((userRow) => [userRow.id, userRow]));

  return assignments
    .map((assignment) => {
      const userRow = usersById.get(assignment.userId);
      if (userRow === undefined) {
        return null;
      }

      const normalizedName = userRow.name.trim();
      return {
        id: `${assignment.userId}:${assignment.relation}`,
        role: mapRelation(assignment.relation),
        userEmail: userRow.email,
        userId: assignment.userId,
        userName: normalizedName === '' ? userRow.email : userRow.name,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) =>
      `${left.userName}:${left.userEmail}`.localeCompare(`${right.userName}:${right.userEmail}`),
    );
};

const buildFactoryAccessCondition = (access: ManagementAccessContext) =>
  access.navigation.isSysadmin ? undefined : inArray(factory.id, access.manageableFactoryIds);

const buildDepartmentAccessCondition = (access: ManagementAccessContext) => {
  if (access.navigation.isSysadmin) {
    return undefined;
  }

  const branches = [
    access.manageableDepartmentIds.length > 0
      ? inArray(department.id, access.manageableDepartmentIds)
      : undefined,
    access.manageableFactoryIds.length > 0
      ? inArray(department.factoryId, access.manageableFactoryIds)
      : undefined,
  ].filter((branch): branch is NonNullable<typeof branch> => branch !== undefined);

  if (branches.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: FORBIDDEN_MESSAGE,
    });
  }

  return branches.length === 1 ? branches[0] : or(...branches);
};

const buildDeviceScopeAccessCondition = (access: ManagementAccessContext) => {
  if (access.navigation.isSysadmin) {
    return undefined;
  }

  const branches = [
    access.manageableDepartmentIds.length > 0
      ? inArray(department.id, access.manageableDepartmentIds)
      : undefined,
    access.manageableFactoryIds.length > 0
      ? inArray(factory.id, access.manageableFactoryIds)
      : undefined,
  ].filter((branch): branch is NonNullable<typeof branch> => branch !== undefined);

  if (branches.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: FORBIDDEN_MESSAGE,
    });
  }

  return branches.length === 1 ? branches[0] : or(...branches);
};

const buildRoleLabel = (role: 'admin' | 'read' | 'viewer' | 'write') => {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'viewer':
      return 'Viewer';
    case 'read':
      return 'Read';
    case 'write':
      return 'Write';
  }
};

export const accessControlQueryProcedures = {
  getNavigation: protectedProcedure.query(async ({ ctx }) =>
    readManagementAccessContext(ctx.user.id, ctx.user.role).then((access) => access.navigation),
  ),
  getScopeAssignments: protectedProcedure
    .input(accessControlScopeQueryInputSchema)
    .query(async ({ input, ctx }) => {
      await assertUserCanManageScope(ctx, input);

      const selectUsers = async (userIds: readonly string[]) => {
        if (userIds.length === 0) {
          return [];
        }

        return ctx.db
          .select({
            email: user.email,
            id: user.id,
            name: user.name,
          })
          .from(user)
          .where(inArray(user.id, [...userIds]));
      };

      switch (input.scopeType) {
        case 'factory':
          return {
            rows: await readScopeAssignmentRows(
              createAuthzObject(AUTHZ_TYPE_FACTORY, input.scopeId),
              [AUTHZ_RELATION_ADMIN, AUTHZ_RELATION_VIEWER],
              (relation) => (relation === AUTHZ_RELATION_ADMIN ? 'admin' : 'viewer'),
              selectUsers,
            ),
          };
        case 'department':
          return {
            rows: await readScopeAssignmentRows(
              createAuthzObject(AUTHZ_TYPE_DEPARTMENT, input.scopeId),
              [AUTHZ_RELATION_ADMIN, AUTHZ_RELATION_VIEWER],
              (relation) => (relation === AUTHZ_RELATION_ADMIN ? 'admin' : 'viewer'),
              selectUsers,
            ),
          };
        case 'device':
          return {
            rows: await readScopeAssignmentRows(
              createAuthzObject(AUTHZ_TYPE_DEVICE, input.scopeId),
              [AUTHZ_RELATION_VIEWER],
              () => 'viewer',
              selectUsers,
            ),
          };
        case 'component':
          return {
            rows: await readScopeAssignmentRows(
              createAuthzObject(AUTHZ_TYPE_DEVICE_COMPONENT, input.scopeId),
              [AUTHZ_RELATION_READER, AUTHZ_RELATION_WRITER],
              (relation) => (relation === AUTHZ_RELATION_WRITER ? 'write' : 'read'),
              selectUsers,
            ),
          };
      }
    }),
  listAssignableUsers: protectedProcedure
    .input(accessControlUserSearchInputSchema)
    .query(async ({ input, ctx }) => {
      await readManagementAccessContext(ctx.user.id, ctx.user.role);

      const searchPattern = buildSearchPattern(input.query);
      const whereClause =
        searchPattern === null
          ? undefined
          : or(ilike(user.name, searchPattern), ilike(user.email, searchPattern));

      return ctx.db
        .select({
          email: user.email,
          id: user.id,
          name: user.name,
          role: user.role,
        })
        .from(user)
        .where(whereClause)
        .orderBy(asc(user.name), asc(user.email))
        .limit(input.limit);
    }),
  listScopeApps: protectedProcedure
    .input(accessControlPageInputSchema)
    .query(async ({ input, ctx }) => {
      const access = await readManagementAccessContext(ctx.user.id, ctx.user.role);
      if (!access.navigation.showApps) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: FORBIDDEN_MESSAGE,
        });
      }

      const accessCondition = buildDeviceScopeAccessCondition(access);
      const searchPattern = buildSearchPattern(input.name);
      const searchCondition =
        searchPattern === null
          ? undefined
          : or(
              ilike(deviceComponentCatalog.displayName, searchPattern),
              ilike(deviceComponentCatalog.key, searchPattern),
              ilike(deviceComponentCatalog.serviceName, searchPattern),
              ilike(device.name, searchPattern),
              ilike(department.name, searchPattern),
              ilike(factory.name, searchPattern),
            );

      const whereClause =
        accessCondition === undefined && searchCondition === undefined
          ? undefined
          : and(accessCondition, searchCondition);

      const totalCountRows = await ctx.db
        .select({ totalCount: sql<number>`cast(count(*) as int)` })
        .from(deviceComponentInstallation)
        .innerJoin(
          deviceComponentCatalog,
          eq(deviceComponentCatalog.key, deviceComponentInstallation.componentKey),
        )
        .innerJoin(device, eq(device.id, deviceComponentInstallation.deviceId))
        .innerJoin(department, eq(department.id, device.departmentId))
        .innerJoin(factory, eq(factory.id, department.factoryId))
        .where(whereClause);
      const totalCount = totalCountRows[0]?.totalCount ?? 0;

      const rows = await ctx.db
        .select({
          componentDisplayName: deviceComponentCatalog.displayName,
          componentKey: deviceComponentInstallation.componentKey,
          departmentName: department.name,
          deviceId: device.id,
          deviceName: device.name,
          enabled: deviceComponentInstallation.enabled,
          factoryName: factory.name,
          id: deviceComponentInstallation.id,
          navigationLabel: deviceComponentCatalog.navigationLabel,
          serviceName: deviceComponentCatalog.serviceName,
        })
        .from(deviceComponentInstallation)
        .innerJoin(
          deviceComponentCatalog,
          eq(deviceComponentCatalog.key, deviceComponentInstallation.componentKey),
        )
        .innerJoin(device, eq(device.id, deviceComponentInstallation.deviceId))
        .innerJoin(department, eq(department.id, device.departmentId))
        .innerJoin(factory, eq(factory.id, department.factoryId))
        .where(whereClause)
        .orderBy(
          asc(factory.name),
          asc(department.name),
          asc(device.name),
          asc(deviceComponentCatalog.displayName),
        )
        .limit(input.perPage)
        .offset((input.page - 1) * input.perPage);

      const [enabledRows, deviceCountRows] = await Promise.all([
        ctx.db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(deviceComponentInstallation)
          .innerJoin(device, eq(device.id, deviceComponentInstallation.deviceId))
          .innerJoin(department, eq(department.id, device.departmentId))
          .innerJoin(factory, eq(factory.id, department.factoryId))
          .where(and(accessCondition, eq(deviceComponentInstallation.enabled, true))),
        ctx.db
          .select({ count: sql<number>`cast(count(distinct ${device.id}) as int)` })
          .from(deviceComponentInstallation)
          .innerJoin(device, eq(device.id, deviceComponentInstallation.deviceId))
          .innerJoin(department, eq(department.id, device.departmentId))
          .innerJoin(factory, eq(factory.id, department.factoryId))
          .where(accessCondition),
      ]);

      const accessCounts = await Promise.all(
        rows.map(async (row) => {
          const assignments = await readDirectUserAssignments(
            createAuthzObject(AUTHZ_TYPE_DEVICE_COMPONENT, row.id),
            [AUTHZ_RELATION_READER, AUTHZ_RELATION_WRITER],
          );
          const counts = countAssignmentsByRelation(assignments);
          return {
            id: row.id,
            readCount: counts.get(AUTHZ_RELATION_READER) ?? 0,
            writeCount: counts.get(AUTHZ_RELATION_WRITER) ?? 0,
          };
        }),
      );

      const countsById = new Map(accessCounts.map((entry) => [entry.id, entry]));

      return {
        navigation: access.navigation,
        stats: {
          deviceCount: deviceCountRows[0]?.count ?? 0,
          enabledInstallationCount: enabledRows[0]?.count ?? 0,
          installationCount: totalCount,
        },
        table: {
          ...toPaginationMeta(input.page, input.perPage, totalCount),
          rows: rows.map((row) => ({
            ...row,
            readCount: countsById.get(row.id)?.readCount ?? 0,
            writeCount: countsById.get(row.id)?.writeCount ?? 0,
          })),
        },
      };
    }),
  listScopeDepartments: protectedProcedure
    .input(accessControlPageInputSchema)
    .query(async ({ input, ctx }) => {
      const access = await readManagementAccessContext(ctx.user.id, ctx.user.role);
      if (!access.navigation.showDepartments) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: FORBIDDEN_MESSAGE,
        });
      }

      const accessCondition = buildDepartmentAccessCondition(access);
      const searchPattern = buildSearchPattern(input.name);
      const searchCondition =
        searchPattern === null
          ? undefined
          : or(ilike(department.name, searchPattern), ilike(department.description, searchPattern));
      const whereClause =
        accessCondition === undefined && searchCondition === undefined
          ? undefined
          : and(accessCondition, searchCondition);

      const totalCountRows = await ctx.db
        .select({ totalCount: sql<number>`cast(count(*) as int)` })
        .from(department)
        .where(whereClause);
      const totalCount = totalCountRows[0]?.totalCount ?? 0;

      const rows = await ctx.db
        .select({
          description: department.description,
          deviceCount: sql<number>`cast(count(distinct ${device.id}) as int)`,
          factoryName: factory.name,
          id: department.id,
          name: department.name,
        })
        .from(department)
        .innerJoin(factory, eq(factory.id, department.factoryId))
        .leftJoin(device, eq(device.departmentId, department.id))
        .where(whereClause)
        .groupBy(department.id, factory.id)
        .orderBy(asc(factory.name), asc(department.name))
        .limit(input.perPage)
        .offset((input.page - 1) * input.perPage);

      const [deviceCountRows, activeDeviceCountRows] = await Promise.all([
        ctx.db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(device)
          .innerJoin(department, eq(department.id, device.departmentId))
          .innerJoin(factory, eq(factory.id, department.factoryId))
          .where(accessCondition),
        ctx.db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(device)
          .innerJoin(department, eq(department.id, device.departmentId))
          .innerJoin(factory, eq(factory.id, department.factoryId))
          .where(and(accessCondition, eq(device.isActive, true))),
      ]);

      const accessCounts = await Promise.all(
        rows.map(async (row) => {
          const assignments = await readDirectUserAssignments(
            createAuthzObject(AUTHZ_TYPE_DEPARTMENT, row.id),
            [AUTHZ_RELATION_ADMIN, AUTHZ_RELATION_VIEWER],
          );
          const counts = countAssignmentsByRelation(assignments);
          return {
            adminCount: counts.get(AUTHZ_RELATION_ADMIN) ?? 0,
            id: row.id,
            viewerCount: counts.get(AUTHZ_RELATION_VIEWER) ?? 0,
          };
        }),
      );

      const countsById = new Map(accessCounts.map((entry) => [entry.id, entry]));

      return {
        navigation: access.navigation,
        stats: {
          activeDeviceCount: activeDeviceCountRows[0]?.count ?? 0,
          departmentCount: totalCount,
          deviceCount: deviceCountRows[0]?.count ?? 0,
        },
        table: {
          ...toPaginationMeta(input.page, input.perPage, totalCount),
          rows: rows.map((row) => ({
            ...row,
            directAdminCount: countsById.get(row.id)?.adminCount ?? 0,
            directViewerCount: countsById.get(row.id)?.viewerCount ?? 0,
          })),
        },
      };
    }),
  listScopeDevices: protectedProcedure
    .input(accessControlPageInputSchema)
    .query(async ({ input, ctx }) => {
      const access = await readManagementAccessContext(ctx.user.id, ctx.user.role);
      if (!access.navigation.showDevices) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: FORBIDDEN_MESSAGE,
        });
      }

      const accessCondition = buildDeviceScopeAccessCondition(access);
      const searchPattern = buildSearchPattern(input.name);
      const searchCondition =
        searchPattern === null
          ? undefined
          : or(ilike(device.name, searchPattern), ilike(device.description, searchPattern));
      const whereClause =
        accessCondition === undefined && searchCondition === undefined
          ? undefined
          : and(accessCondition, searchCondition);

      const totalCountRows = await ctx.db
        .select({ totalCount: sql<number>`cast(count(*) as int)` })
        .from(device)
        .innerJoin(department, eq(department.id, device.departmentId))
        .innerJoin(factory, eq(factory.id, department.factoryId))
        .where(whereClause);
      const totalCount = totalCountRows[0]?.totalCount ?? 0;

      const rows = await ctx.db
        .select({
          departmentName: department.name,
          description: device.description,
          enabledAppCount: sql<number>`cast(count(case when ${deviceComponentInstallation.enabled} then 1 end) as int)`,
          factoryName: factory.name,
          id: device.id,
          isActive: device.isActive,
          name: device.name,
          totalAppCount: sql<number>`cast(count(${deviceComponentInstallation.id}) as int)`,
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

      const [activeDeviceCountRows, enabledAppCountRows] = await Promise.all([
        ctx.db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(device)
          .innerJoin(department, eq(department.id, device.departmentId))
          .innerJoin(factory, eq(factory.id, department.factoryId))
          .where(and(accessCondition, eq(device.isActive, true))),
        ctx.db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(deviceComponentInstallation)
          .innerJoin(device, eq(device.id, deviceComponentInstallation.deviceId))
          .innerJoin(department, eq(department.id, device.departmentId))
          .innerJoin(factory, eq(factory.id, department.factoryId))
          .where(and(accessCondition, eq(deviceComponentInstallation.enabled, true))),
      ]);

      const accessCounts = await Promise.all(
        rows.map(async (row) => {
          const assignments = await readDirectUserAssignments(
            createAuthzObject(AUTHZ_TYPE_DEVICE, row.id),
            [AUTHZ_RELATION_VIEWER],
          );
          return {
            id: row.id,
            viewerCount: assignments.length,
          };
        }),
      );

      const countsById = new Map(accessCounts.map((entry) => [entry.id, entry.viewerCount]));

      return {
        navigation: access.navigation,
        stats: {
          activeDeviceCount: activeDeviceCountRows[0]?.count ?? 0,
          deviceCount: totalCount,
          enabledAppCount: enabledAppCountRows[0]?.count ?? 0,
        },
        table: {
          ...toPaginationMeta(input.page, input.perPage, totalCount),
          rows: rows.map((row) => ({
            ...row,
            directViewerCount: countsById.get(row.id) ?? 0,
          })),
        },
      };
    }),
  listScopeFactories: protectedProcedure
    .input(accessControlPageInputSchema)
    .query(async ({ input, ctx }) => {
      const access = await readManagementAccessContext(ctx.user.id, ctx.user.role);
      if (!access.navigation.showFactories) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: FORBIDDEN_MESSAGE,
        });
      }

      const accessCondition = buildFactoryAccessCondition(access);
      const searchPattern = buildSearchPattern(input.name);
      const searchCondition =
        searchPattern === null
          ? undefined
          : or(ilike(factory.name, searchPattern), ilike(factory.description, searchPattern));
      const whereClause =
        accessCondition === undefined && searchCondition === undefined
          ? undefined
          : and(accessCondition, searchCondition);

      const totalCountRows = await ctx.db
        .select({ totalCount: sql<number>`cast(count(*) as int)` })
        .from(factory)
        .where(whereClause);
      const totalCount = totalCountRows[0]?.totalCount ?? 0;

      const rows = await ctx.db
        .select({
          departmentCount: sql<number>`cast(count(distinct ${department.id}) as int)`,
          description: factory.description,
          deviceCount: sql<number>`cast(count(distinct ${device.id}) as int)`,
          id: factory.id,
          name: factory.name,
        })
        .from(factory)
        .leftJoin(department, eq(department.factoryId, factory.id))
        .leftJoin(device, eq(device.departmentId, department.id))
        .where(whereClause)
        .groupBy(factory.id)
        .orderBy(asc(factory.name))
        .limit(input.perPage)
        .offset((input.page - 1) * input.perPage);

      const [departmentCountRows, deviceCountRows] = await Promise.all([
        ctx.db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(department)
          .innerJoin(factory, eq(factory.id, department.factoryId))
          .where(accessCondition),
        ctx.db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(device)
          .innerJoin(department, eq(department.id, device.departmentId))
          .innerJoin(factory, eq(factory.id, department.factoryId))
          .where(accessCondition),
      ]);

      const accessCounts = await Promise.all(
        rows.map(async (row) => {
          const assignments = await readDirectUserAssignments(
            createAuthzObject(AUTHZ_TYPE_FACTORY, row.id),
            [AUTHZ_RELATION_ADMIN, AUTHZ_RELATION_VIEWER],
          );
          const counts = countAssignmentsByRelation(assignments);
          return {
            adminCount: counts.get(AUTHZ_RELATION_ADMIN) ?? 0,
            id: row.id,
            viewerCount: counts.get(AUTHZ_RELATION_VIEWER) ?? 0,
          };
        }),
      );

      const countsById = new Map(accessCounts.map((entry) => [entry.id, entry]));

      return {
        navigation: access.navigation,
        stats: {
          departmentCount: departmentCountRows[0]?.count ?? 0,
          deviceCount: deviceCountRows[0]?.count ?? 0,
          factoryCount: totalCount,
        },
        table: {
          ...toPaginationMeta(input.page, input.perPage, totalCount),
          rows: rows.map((row) => ({
            ...row,
            directAdminCount: countsById.get(row.id)?.adminCount ?? 0,
            directViewerCount: countsById.get(row.id)?.viewerCount ?? 0,
          })),
        },
      };
    }),
  listUsers: protectedProcedure
    .input(accessControlPageInputSchema)
    .query(async ({ input, ctx }) => {
      requireSysAdmin(ctx.user.role);

      const searchPattern = buildSearchPattern(input.name);
      const whereClause =
        searchPattern === null
          ? undefined
          : or(ilike(user.name, searchPattern), ilike(user.email, searchPattern));

      const [totalCountRows, rows, statsRows] = await Promise.all([
        ctx.db
          .select({ totalCount: sql<number>`cast(count(*) as int)` })
          .from(user)
          .where(whereClause),
        ctx.db
          .select({
            banExpires: user.banExpires,
            banned: user.banned,
            createdAt: user.createdAt,
            email: user.email,
            emailVerified: user.emailVerified,
            id: user.id,
            name: user.name,
            role: user.role,
          })
          .from(user)
          .where(whereClause)
          .orderBy(asc(user.name), asc(user.email))
          .limit(input.perPage)
          .offset((input.page - 1) * input.perPage),
        ctx.db
          .select({
            adminCount: sql<number>`cast(count(case when ${user.role} ilike '%admin%' then 1 end) as int)`,
            bannedCount: sql<number>`cast(count(case when ${user.banned} then 1 end) as int)`,
            verifiedCount: sql<number>`cast(count(case when ${user.emailVerified} then 1 end) as int)`,
          })
          .from(user),
      ]);

      const totalCount = totalCountRows[0]?.totalCount ?? 0;

      return {
        navigation: buildNavigation(true, [], []),
        stats: {
          adminCount: statsRows[0]?.adminCount ?? 0,
          bannedCount: statsRows[0]?.bannedCount ?? 0,
          userCount: totalCount,
          verifiedCount: statsRows[0]?.verifiedCount ?? 0,
        },
        table: {
          ...toPaginationMeta(input.page, input.perPage, totalCount),
          rows,
        },
      };
    }),
};

export const formatAccessControlRoleLabel = buildRoleLabel;
