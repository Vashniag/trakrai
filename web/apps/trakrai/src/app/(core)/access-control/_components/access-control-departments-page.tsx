'use client';

import { useMemo } from 'react';

import Link from 'next/link';

import { AccessControlScopeManagerModal } from '@/app/(core)/access-control/_components/access-control-scope-manager-modal';
import { AccessControlShell } from '@/app/(core)/access-control/_components/access-control-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type DepartmentsPageData = RouterOutput['accessControl']['listScopeDepartments'];
type DepartmentRow = DepartmentsPageData['table']['rows'][number];

const roleOptions = [
  { label: 'Viewer', value: 'viewer' as const },
  { label: 'Admin', value: 'admin' as const },
];

export const AccessControlDepartmentsPage = ({
  data,
}: Readonly<{
  data: DepartmentsPageData;
}>) => {
  const columns = useMemo<ColumnDef<DepartmentRow>[]>(
    () => [
      {
        accessorKey: 'name',
        id: 'name',
        cell: ({ row }) => (
          <div className="space-y-1">
            <Link
              className="text-foreground font-medium underline-offset-4 hover:underline"
              href={`/departments/${row.original.id}`}
            >
              {row.original.name}
            </Link>
            <div className="text-muted-foreground text-xs">{row.original.factoryName}</div>
          </div>
        ),
        enableColumnFilter: true,
        header: 'Department',
        meta: {
          label: 'Department',
          placeholder: 'Search departments',
          variant: 'text',
        },
      },
      {
        accessorKey: 'deviceCount',
        header: 'Devices',
      },
      {
        accessorKey: 'directAdminCount',
        header: 'Admins',
      },
      {
        accessorKey: 'directViewerCount',
        header: 'Viewers',
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <AccessControlScopeManagerModal
            roleOptions={roleOptions}
            scopeId={row.original.id}
            scopeLabel={`${row.original.factoryName} / ${row.original.name}`}
            scopeType="department"
          />
        ),
        header: 'Actions',
      },
    ],
    [],
  );

  return (
    <AccessControlShell
      currentTab="departments"
      description="Department subtree delegation. Direct admins can manage users and downstream device or app permissions within their department."
      navigation={data.navigation}
      stats={
        <>
          <StatCard
            description="Departments matching the active filter."
            title="Departments"
            value={data.stats.departmentCount}
          />
          <StatCard
            description="Devices inside visible department scope."
            title="Devices"
            value={data.stats.deviceCount}
          />
          <StatCard
            description="Devices flagged active in visible scope."
            title="Active Devices"
            value={data.stats.activeDeviceCount}
          />
        </>
      }
      title="Department Permissions"
    >
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden border">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Department Scopes</h2>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-6">
          <ServerDataTable
            columns={columns}
            data={data.table.rows}
            pageCount={data.table.pageCount}
          />
        </div>
      </section>
    </AccessControlShell>
  );
};
