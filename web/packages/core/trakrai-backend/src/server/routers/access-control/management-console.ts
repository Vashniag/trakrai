import { asc, inArray } from 'drizzle-orm';

import type { ProtectedContext } from './helpers';

import { user } from '../../../db/auth-schema';
import {
  department,
  device,
  deviceComponentCatalog,
  deviceComponentInstallation,
  factory,
} from '../../../db/schema';
import {
  getAuthzDebugState,
  getScopedAssignments,
  getUserManagementScopeIds,
  isSysAdminRole,
} from '../../../lib/authz';

export const readManagementConsoleData = async (ctx: ProtectedContext) => {
  const sysadmin = isSysAdminRole(ctx.user.role);
  const allUsers = await ctx.db
    .select({
      banExpires: user.banExpires,
      banReason: user.banReason,
      banned: user.banned,
      createdAt: user.createdAt,
      email: user.email,
      emailVerified: user.emailVerified,
      id: user.id,
      name: user.name,
      role: user.role,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .orderBy(asc(user.name), asc(user.email));

  if (sysadmin) {
    const [factories, departments, devices, catalog, installations, assignments, authz] =
      await Promise.all([
        ctx.db.select().from(factory).orderBy(asc(factory.name)),
        ctx.db.select().from(department).orderBy(asc(department.name)),
        ctx.db.select().from(device).orderBy(asc(device.name)),
        ctx.db.select().from(deviceComponentCatalog).orderBy(asc(deviceComponentCatalog.sortOrder)),
        ctx.db
          .select()
          .from(deviceComponentInstallation)
          .orderBy(asc(deviceComponentInstallation.deviceId)),
        getScopedAssignments(),
        getAuthzDebugState(),
      ]);

    return {
      assignments,
      authz,
      catalog,
      departments,
      devices,
      factories,
      installations,
      isSysadmin: true,
      users: allUsers,
    };
  }

  const managementScopeIds = await getUserManagementScopeIds(ctx.user.id);
  const componentIds = Array.from(managementScopeIds.componentIds);
  const deviceIds = new Set(Array.from(managementScopeIds.deviceIds));
  const departmentIds = new Set(Array.from(managementScopeIds.departmentIds));
  const factoryIds = new Set(Array.from(managementScopeIds.factoryIds));

  const installationRows: Array<typeof deviceComponentInstallation.$inferSelect> =
    componentIds.length === 0
      ? []
      : await ctx.db
          .select()
          .from(deviceComponentInstallation)
          .where(inArray(deviceComponentInstallation.id, componentIds));

  for (const installation of installationRows) {
    deviceIds.add(installation.deviceId);
  }

  const managedDeviceRows: Array<typeof device.$inferSelect> =
    deviceIds.size === 0
      ? []
      : await ctx.db
          .select()
          .from(device)
          .where(inArray(device.id, Array.from(deviceIds)));

  for (const managedDevice of managedDeviceRows) {
    departmentIds.add(managedDevice.departmentId);
  }

  const managedDepartmentRows: Array<typeof department.$inferSelect> =
    departmentIds.size === 0
      ? []
      : await ctx.db
          .select()
          .from(department)
          .where(inArray(department.id, Array.from(departmentIds)));

  for (const managedDepartment of managedDepartmentRows) {
    factoryIds.add(managedDepartment.factoryId);
  }

  const managedFactoryRows: Array<typeof factory.$inferSelect> =
    factoryIds.size === 0
      ? []
      : await ctx.db
          .select()
          .from(factory)
          .where(inArray(factory.id, Array.from(factoryIds)));

  const componentKeys: string[] = Array.from(
    new Set(installationRows.map((row) => row.componentKey)),
  );
  const catalogRows: Array<typeof deviceComponentCatalog.$inferSelect> =
    componentKeys.length === 0
      ? []
      : await ctx.db
          .select()
          .from(deviceComponentCatalog)
          .where(inArray(deviceComponentCatalog.key, componentKeys));

  const assignments = await getScopedAssignments({
    componentIds,
    departmentIds: Array.from(departmentIds),
    deviceIds: Array.from(deviceIds),
    factoryIds: Array.from(factoryIds),
  });

  return {
    assignments,
    authz: null,
    catalog: catalogRows,
    departments: managedDepartmentRows,
    devices: managedDeviceRows,
    factories: managedFactoryRows,
    installations: installationRows,
    isSysadmin: false,
    users: allUsers,
  };
};
