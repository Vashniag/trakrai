'use client';

import { useMemo } from 'react';

import Link from 'next/link';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { WorkspaceShell } from '@/components/hierarchy/workspace-shell';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type DepartmentWorkspace = RouterOutput['workspace']['getDepartmentWorkspace'];
type DeviceRow = DepartmentWorkspace['table']['rows'][number];

const formatTimestamp = (value: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);

export const DepartmentWorkspacePage = ({ data }: Readonly<{ data: DepartmentWorkspace }>) => {
  const columns = useMemo<ColumnDef<DeviceRow>[]>(
    () => [
      {
        accessorKey: 'name',
        id: 'name',
        cell: ({ row }) => (
          <div className="space-y-1">
            <Link
              className="text-foreground font-medium underline-offset-4 hover:underline"
              href={`/devices/${row.original.id}`}
            >
              {row.original.name}
            </Link>
            <div className="text-muted-foreground text-xs">
              {row.original.description?.trim() !== ''
                ? row.original.description
                : 'No device description.'}
            </div>
          </div>
        ),
        enableColumnFilter: true,
        header: 'Device',
        meta: {
          label: 'Device',
          placeholder: 'Search devices',
          variant: 'text',
        },
      },
      {
        accessorKey: 'enabledAppCount',
        header: 'Enabled Apps',
      },
      {
        accessorKey: 'totalAppCount',
        header: 'Total Apps',
      },
      {
        accessorKey: 'directUserCount',
        header: 'Direct Users',
      },
      {
        accessorKey: 'isActive',
        cell: ({ row }) => (
          <span className="text-xs font-medium tracking-[0.18em] uppercase">
            {row.original.isActive ? 'Active' : 'Paused'}
          </span>
        ),
        header: 'Status',
      },
      {
        accessorKey: 'updatedAt',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {formatTimestamp(row.original.updatedAt)}
          </span>
        ),
        header: 'Updated',
      },
    ],
    [],
  );

  return (
    <WorkspaceShell
      currentSidebarItemId={data.selectedDepartment.id}
      description={`Department inside ${data.selectedDepartment.factoryName}, with paginated device browsing and app activity summaries.`}
      eyebrow="Department Workspace"
      sidebarDescription="Departments visible from your current factory or direct department scope."
      sidebarItems={data.departments.map((departmentRow) => ({
        badge: departmentRow.deviceCount,
        description: departmentRow.description,
        href: `/departments/${departmentRow.id}`,
        id: departmentRow.id,
        label: departmentRow.name,
        meta: `${departmentRow.activeDeviceCount} active`,
      }))}
      sidebarTitle="Departments"
      stats={
        <>
          <StatCard
            description="Devices registered under this department."
            title="Devices"
            value={data.stats.deviceCount}
          />
          <StatCard
            description="Devices currently active."
            title="Active Devices"
            value={data.stats.activeDeviceCount}
          />
          <StatCard
            description="Enabled apps across all devices in this department."
            title="Enabled Apps"
            value={data.stats.enabledAppCount}
          />
          <StatCard
            description="Direct department-level admins and viewers."
            title="Direct Users"
            value={data.stats.directUserCount}
          />
        </>
      }
      title={data.selectedDepartment.name}
    >
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Devices</CardTitle>
          <CardDescription>
            Search and paginate devices inside this department while keeping queries server-side.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <ServerDataTable
            columns={columns}
            data={data.table.rows}
            pageCount={data.table.pageCount}
          />
        </CardContent>
      </Card>
    </WorkspaceShell>
  );
};
