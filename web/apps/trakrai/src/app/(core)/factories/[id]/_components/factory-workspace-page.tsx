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

type FactoryWorkspace = RouterOutput['workspace']['getFactoryWorkspace'];
type DepartmentRow = FactoryWorkspace['table']['rows'][number];

const formatTimestamp = (value: Date): string =>
  new Intl.DateTimeFormat(undefined, {
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
          <div className="space-y-1">
            <Link
              className="text-foreground font-medium underline-offset-4 hover:underline"
              href={`/departments/${row.original.id}`}
            >
              {row.original.name}
            </Link>
            <div className="text-muted-foreground text-xs">
              {row.original.description?.trim() !== ''
                ? row.original.description
                : 'No department description.'}
            </div>
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
        accessorKey: 'directUserCount',
        header: 'Users',
      },
      {
        accessorKey: 'directAdminCount',
        header: 'Admins',
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
          <StatCard
            description="Departments inside this factory subtree."
            title="Departments"
            value={data.stats.departmentCount}
          />
          <StatCard
            description="Total registered devices across all departments."
            title="Devices"
            value={data.stats.deviceCount}
          />
          <StatCard
            description="Devices currently marked active."
            title="Active Devices"
            value={data.stats.activeDeviceCount}
          />
          <StatCard
            description="Direct factory-level admins and viewers."
            title="Direct Users"
            value={data.stats.directUserCount}
          />
        </>
      }
      title={data.selectedFactory.name}
    >
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Departments</CardTitle>
          <CardDescription>
            Search and paginate departments without loading the full factory into the browser.
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
