'use client';

import { useMemo } from 'react';

import Link from 'next/link';

import { useMutation } from '@tanstack/react-query';

import { betterAuthAdminApi } from '@/lib/better-auth-admin';
import { useInvalidateQuery, useTRPCMutation, useTRPCQuery } from '@/server/react';

import { AccessControlAssignmentsSection } from './access-control-assignments-section';
import { AccessControlDeviceAppCatalogSection } from './access-control-device-app-catalog-section';
import { AccessControlDeviceAppInstallationsSection } from './access-control-device-app-installations-section';
import { AccessControlHierarchyManagementSection } from './access-control-hierarchy-management-section';
import { AccessControlHierarchySummary } from './access-control-hierarchy-summary';
import {
  EMPTY_CATALOG,
  EMPTY_DEPARTMENTS,
  EMPTY_DEVICES,
  EMPTY_FACTORIES,
  EMPTY_INSTALLATIONS,
  EMPTY_USERS,
  formatUserLabel,
  toTitleCase,
  type AssignmentTableRow,
  type BanUserValues,
  type CreateUserValues,
  type InstallationTableRow,
  type ResetPasswordValues,
  type SetUserRoleValues,
  type UserIdValues,
  type UserTableRow,
} from './access-control-page-lib';
import { AccessControlUserLifecycleSection } from './access-control-user-lifecycle-section';

export const AccessControlPage = () => {
  const invalidateQuery = useInvalidateQuery();
  const managementConsoleQuery = useTRPCQuery((api) => ({
    ...api.accessControl.getManagementConsole.queryOptions(),
    retry: false,
  }));

  const createFactoryMutation = useTRPCMutation((api) =>
    api.accessControl.createFactory.mutationOptions(),
  );
  const updateFactoryMutation = useTRPCMutation((api) =>
    api.accessControl.updateFactory.mutationOptions(),
  );
  const createDepartmentMutation = useTRPCMutation((api) =>
    api.accessControl.createDepartment.mutationOptions(),
  );
  const updateDepartmentMutation = useTRPCMutation((api) =>
    api.accessControl.updateDepartment.mutationOptions(),
  );
  const createCatalogMutation = useTRPCMutation((api) =>
    api.accessControl.createCatalogEntry.mutationOptions(),
  );
  const updateCatalogMutation = useTRPCMutation((api) =>
    api.accessControl.updateCatalogEntry.mutationOptions(),
  );
  const setInstallationStateMutation = useTRPCMutation((api) =>
    api.accessControl.setInstallationState.mutationOptions(),
  );
  const upsertAssignmentMutation = useTRPCMutation((api) =>
    api.accessControl.upsertAssignment.mutationOptions(),
  );
  const removeAssignmentMutation = useTRPCMutation((api) =>
    api.accessControl.removeAssignment.mutationOptions(),
  );

  const createUserMutation = useMutation({
    mutationFn: async (values: CreateUserValues) =>
      betterAuthAdminApi.createUser({
        data: {
          emailVerified: values.emailVerified,
        },
        email: values.email,
        name: values.name,
        password: values.password,
        role: values.role,
      }),
  });
  const setUserRoleMutation = useMutation({
    mutationFn: (values: SetUserRoleValues) => betterAuthAdminApi.setRole(values),
  });
  const resetPasswordMutation = useMutation({
    mutationFn: (values: ResetPasswordValues) => betterAuthAdminApi.setUserPassword(values),
  });
  const banUserMutation = useMutation({
    mutationFn: (values: BanUserValues) => betterAuthAdminApi.banUser(values),
  });
  const unbanUserMutation = useMutation({
    mutationFn: (values: UserIdValues) => betterAuthAdminApi.unbanUser(values),
  });
  const removeUserMutation = useMutation({
    mutationFn: (values: UserIdValues) => betterAuthAdminApi.removeUser(values),
  });

  const refreshConsole = async () => {
    await invalidateQuery((api) => api.accessControl.getManagementConsole);
    await invalidateQuery((api) => api.devices.list);
  };

  const consoleData = managementConsoleQuery.data;
  const loadError =
    managementConsoleQuery.error instanceof Error
      ? managementConsoleQuery.error.message
      : 'Failed to load access control console.';
  const isUnauthorized = managementConsoleQuery.error?.message === 'UNAUTHORIZED';

  const users = consoleData?.users ?? EMPTY_USERS;
  const factories = consoleData?.factories ?? EMPTY_FACTORIES;
  const departments = consoleData?.departments ?? EMPTY_DEPARTMENTS;
  const devices = consoleData?.devices ?? EMPTY_DEVICES;
  const catalog = consoleData?.catalog ?? EMPTY_CATALOG;
  const installations = consoleData?.installations ?? EMPTY_INSTALLATIONS;
  const assignments = consoleData?.assignments;

  const userMap = useMemo(() => new Map(users.map((row) => [row.id, row])), [users]);
  const factoryMap = useMemo(() => new Map(factories.map((row) => [row.id, row])), [factories]);
  const departmentMap = useMemo(
    () => new Map(departments.map((row) => [row.id, row])),
    [departments],
  );
  const deviceMap = useMemo(() => new Map(devices.map((row) => [row.id, row])), [devices]);
  const catalogMap = useMemo(() => new Map(catalog.map((row) => [row.key, row])), [catalog]);
  const installationById = useMemo(
    () => new Map(installations.map((row) => [row.id, row])),
    [installations],
  );

  const assignmentRows = useMemo<AssignmentTableRow[]>(() => {
    if (assignments === undefined) {
      return [];
    }

    const rows: AssignmentTableRow[] = [];

    for (const assignmentRow of assignments.factoryAssignmentRows) {
      const userRow = userMap.get(assignmentRow.userId);
      const factoryRow = factoryMap.get(assignmentRow.factoryId);
      if (userRow === undefined || factoryRow === undefined) {
        continue;
      }

      rows.push({
        id: `factory:${assignmentRow.factoryId}:${assignmentRow.userId}`,
        permissionLabel: toTitleCase(assignmentRow.role),
        scopeId: assignmentRow.factoryId,
        scopeLabel: factoryRow.name,
        scopeType: 'factory',
        userEmail: userRow.email,
        userId: userRow.id,
        userName: userRow.name,
      });
    }

    for (const assignmentRow of assignments.departmentAssignmentRows) {
      const userRow = userMap.get(assignmentRow.userId);
      const departmentRow = departmentMap.get(assignmentRow.departmentId);
      if (userRow === undefined || departmentRow === undefined) {
        continue;
      }

      rows.push({
        id: `department:${assignmentRow.departmentId}:${assignmentRow.userId}`,
        permissionLabel: toTitleCase(assignmentRow.role),
        scopeId: assignmentRow.departmentId,
        scopeLabel: departmentRow.name,
        scopeType: 'department',
        userEmail: userRow.email,
        userId: userRow.id,
        userName: userRow.name,
      });
    }

    for (const assignmentRow of assignments.deviceAssignmentRows) {
      const userRow = userMap.get(assignmentRow.userId);
      const deviceRow = deviceMap.get(assignmentRow.deviceId);
      if (userRow === undefined || deviceRow === undefined) {
        continue;
      }

      rows.push({
        id: `device:${assignmentRow.deviceId}:${assignmentRow.userId}`,
        permissionLabel: 'Viewer',
        scopeId: assignmentRow.deviceId,
        scopeLabel: deviceRow.name,
        scopeType: 'device',
        userEmail: userRow.email,
        userId: userRow.id,
        userName: userRow.name,
      });
    }

    for (const assignmentRow of assignments.componentAssignmentRows) {
      const userRow = userMap.get(assignmentRow.userId);
      const installationRow = installationById.get(assignmentRow.componentId);
      const deviceRow =
        installationRow === undefined ? undefined : deviceMap.get(installationRow.deviceId);
      const catalogRow =
        installationRow === undefined ? undefined : catalogMap.get(installationRow.componentKey);
      if (
        userRow === undefined ||
        deviceRow === undefined ||
        catalogRow === undefined ||
        installationRow === undefined
      ) {
        continue;
      }

      rows.push({
        id: `component:${assignmentRow.componentId}:${assignmentRow.userId}`,
        permissionLabel: assignmentRow.accessLevel === 'write' ? 'Write' : 'Read',
        scopeId: installationRow.id,
        scopeLabel: `${deviceRow.name} / ${catalogRow.displayName}`,
        scopeType: 'component',
        userEmail: userRow.email,
        userId: userRow.id,
        userName: userRow.name,
      });
    }

    return rows.sort((left, right) => left.scopeLabel.localeCompare(right.scopeLabel));
  }, [assignments, catalogMap, departmentMap, deviceMap, factoryMap, installationById, userMap]);

  const assignmentCountByUserId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of assignmentRows) {
      counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
    }
    return counts;
  }, [assignmentRows]);

  const userRows = useMemo<UserTableRow[]>(
    () =>
      users.map((row) => ({
        ...row,
        assignmentCount: assignmentCountByUserId.get(row.id) ?? 0,
      })),
    [assignmentCountByUserId, users],
  );

  const installationRows = useMemo<InstallationTableRow[]>(
    () =>
      installations
        .map((row) => {
          const deviceRow = deviceMap.get(row.deviceId);
          const catalogRow = catalogMap.get(row.componentKey);
          if (deviceRow === undefined || catalogRow === undefined) {
            return null;
          }

          return {
            componentDisplayName: catalogRow.displayName,
            componentKey: row.componentKey,
            deviceId: row.deviceId,
            deviceName: deviceRow.name,
            enabled: row.enabled,
            id: row.id,
            installationLabel: `${deviceRow.name} / ${catalogRow.displayName}`,
          };
        })
        .filter((row): row is InstallationTableRow => row !== null),
    [catalogMap, deviceMap, installations],
  );

  const factoryOptions = useMemo(
    () => factories.map((row) => ({ label: row.name, value: row.id })),
    [factories],
  );
  const departmentOptions = useMemo(
    () =>
      departments.map((row) => ({
        label: `${factoryMap.get(row.factoryId)?.name ?? 'Unknown'} / ${row.name}`,
        value: row.id,
      })),
    [departments, factoryMap],
  );
  const deviceOptions = useMemo(
    () =>
      devices.map((row) => ({
        label: `${departmentMap.get(row.departmentId)?.name ?? 'Unknown'} / ${row.name}`,
        value: row.id,
      })),
    [departmentMap, devices],
  );
  const installationOptions = useMemo(
    () =>
      installationRows.map((row) => ({
        label: `${row.installationLabel}${row.enabled ? '' : ' (disabled)'}`,
        value: row.id,
      })),
    [installationRows],
  );
  const userOptions = useMemo(
    () => users.map((row) => ({ label: formatUserLabel(row), value: row.id })),
    [users],
  );

  if (managementConsoleQuery.isLoading) {
    return <div className="text-muted-foreground">Loading access control console...</div>;
  }

  if (isUnauthorized) {
    return (
      <div className="border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900">
        Sign in first.{' '}
        <Link className="underline underline-offset-4" href="/auth/login?redirect=/access-control">
          Go to login
        </Link>
      </div>
    );
  }

  if (managementConsoleQuery.error !== null || consoleData === undefined) {
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive border p-4">
        {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <AccessControlUserLifecycleSection
          banUserMutation={banUserMutation}
          createUserMutation={createUserMutation}
          isSysadmin={consoleData.isSysadmin}
          refreshConsole={refreshConsole}
          removeUserMutation={removeUserMutation}
          resetPasswordMutation={resetPasswordMutation}
          setUserRoleMutation={setUserRoleMutation}
          unbanUserMutation={unbanUserMutation}
          userRows={userRows}
        />
        <AccessControlHierarchySummary
          authz={consoleData.authz}
          departmentCount={departments.length}
          deviceCount={devices.length}
          factoryCount={factories.length}
        />
      </section>
      <AccessControlHierarchyManagementSection
        createDepartmentMutation={createDepartmentMutation}
        createFactoryMutation={createFactoryMutation}
        departments={departments}
        factories={factories}
        factoryOptions={factoryOptions}
        isSysadmin={consoleData.isSysadmin}
        refreshConsole={refreshConsole}
        updateDepartmentMutation={updateDepartmentMutation}
        updateFactoryMutation={updateFactoryMutation}
      />
      <AccessControlAssignmentsSection
        assignmentRows={assignmentRows}
        departmentOptions={departmentOptions}
        deviceOptions={deviceOptions}
        factoryOptions={factoryOptions}
        installationOptions={installationOptions}
        refreshConsole={refreshConsole}
        removeAssignmentMutation={removeAssignmentMutation}
        upsertAssignmentMutation={upsertAssignmentMutation}
        userOptions={userOptions}
      />

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <AccessControlDeviceAppCatalogSection
          catalog={catalog}
          createCatalogMutation={createCatalogMutation}
          installations={installations}
          isSysadmin={consoleData.isSysadmin}
          refreshConsole={refreshConsole}
          updateCatalogMutation={updateCatalogMutation}
        />
        <AccessControlDeviceAppInstallationsSection
          installationRows={installationRows}
          isSysadmin={consoleData.isSysadmin}
          refreshConsole={refreshConsole}
          setInstallationStateMutation={setInstallationStateMutation}
        />
      </section>
    </div>
  );
};
