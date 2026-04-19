'use client';

import { useMemo } from 'react';

import Link from 'next/link';

import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { WorkspaceShell } from '@/components/hierarchy/workspace-shell';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type FactoryWorkspace = RouterOutput['workspace']['getFactoryWorkspace'];
type DepartmentRow = FactoryWorkspace['table']['rows'][number];

const formatTimestamp = (value: Date): string =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);

export const FactoryWorkspacePage = ({ data }: Readonly<{ data: FactoryWorkspace }>) => {
  const columns = useMemo<ColumnDef<DepartmentRow>[]>(
    () => [
      {
        accessorKey: 'name',
        id: 'name',
        cell: ({ row }) => (
          <div>
            <Link
              className="text-foreground font-medium underline-offset-4 hover:underline"
              href={`/departments/${row.original.id}`}
            >
              {row.original.name}
            </Link>
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
        accessorKey: 'activeDeviceCount',
        header: 'Active',
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
      breadcrumbs={[{ label: data.selectedFactory.name }]}
      currentSidebarItemId={data.selectedFactory.id}
      description="Factory workspace with scoped department navigation, aggregated stats, and a server-paginated directory."
      eyebrow="Factory Workspace"
      sidebarDescription="Factories you can access. Select one to inspect departments and aggregate activity."
      sidebarItems={data.factories.map((factoryRow) => ({
        badge: factoryRow.deviceCount,
        description: factoryRow.description,
        href: `/factories/${factoryRow.id}`,
        id: factoryRow.id,
        label: factoryRow.name,
        meta: `${factoryRow.departmentCount} departments`,
      }))}
      sidebarTitle="Factories"
      stats={
        <>
          <StatCard title="Departments" value={data.stats.departmentCount} />
          <StatCard title="Devices" value={data.stats.deviceCount} />
          <StatCard title="Active Devices" value={data.stats.activeDeviceCount} />
        </>
      }
      title={data.selectedFactory.name}
    >
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden border">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Departments</h2>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-6">
          <ServerDataTable
            columns={columns}
            data={data.table.rows}
            pageCount={data.table.pageCount}
          />
        </div>
      </section>
    </WorkspaceShell>
  );
};
