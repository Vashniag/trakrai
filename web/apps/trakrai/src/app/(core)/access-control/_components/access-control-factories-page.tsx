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

import { AccessControlScopeManagerModal } from '@/app/(core)/access-control/_components/access-control-scope-manager-modal';
import { AccessControlShell } from '@/app/(core)/access-control/_components/access-control-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type FactoriesPageData = RouterOutput['accessControl']['listScopeFactories'];
type FactoryRow = FactoriesPageData['table']['rows'][number];

const roleOptions = [
  { label: 'Viewer', value: 'viewer' as const },
  { label: 'Admin', value: 'admin' as const },
];

export const AccessControlFactoriesPage = ({
  data,
}: Readonly<{
  data: FactoriesPageData;
}>) => {
  const columns = useMemo<ColumnDef<FactoryRow>[]>(
    () => [
      {
        accessorKey: 'name',
        id: 'name',
        cell: ({ row }) => (
          <div className="space-y-1">
            <Link
              className="text-foreground font-medium underline-offset-4 hover:underline"
              href={`/factories/${row.original.id}`}
            >
              {row.original.name}
            </Link>
            <div className="text-muted-foreground text-xs">
              {row.original.description?.trim() !== ''
                ? row.original.description
                : 'No factory description.'}
            </div>
          </div>
        ),
        enableColumnFilter: true,
        header: 'Factory',
        meta: {
          label: 'Factory',
          placeholder: 'Search factories',
          variant: 'text',
        },
      },
      {
        accessorKey: 'departmentCount',
        header: 'Departments',
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
            scopeLabel={row.original.name}
            scopeType="factory"
          />
        ),
        header: 'Actions',
      },
    ],
    [],
  );

  return (
    <AccessControlShell
      currentTab="factories"
      description="Factory-level inherited access. Factory admins can delegate department, device, and app permissions down the subtree."
      navigation={data.navigation}
      stats={
        <>
          <StatCard
            description="Factories matching the active filter."
            title="Factories"
            value={data.stats.factoryCount}
          />
          <StatCard
            description="Departments in visible factory scope."
            title="Departments"
            value={data.stats.departmentCount}
          />
          <StatCard
            description="Devices under visible factory scope."
            title="Devices"
            value={data.stats.deviceCount}
          />
        </>
      }
      title="Factory Permissions"
    >
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Factory Scopes</CardTitle>
          <CardDescription>
            Paginated server-side factory directory with direct admin and viewer counts.
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
    </AccessControlShell>
  );
};
