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

type DevicesPageData = RouterOutput['accessControl']['listScopeDevices'];
type DeviceRow = DevicesPageData['table']['rows'][number];

const roleOptions = [{ label: 'Viewer', value: 'viewer' as const }];

export const AccessControlDevicesPage = ({
  data,
}: Readonly<{
  data: DevicesPageData;
}>) => {
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
              {row.original.factoryName} / {row.original.departmentName}
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
        accessorKey: 'directViewerCount',
        header: 'Viewers',
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
        id: 'actions',
        cell: ({ row }) => (
          <AccessControlScopeManagerModal
            roleOptions={roleOptions}
            scopeId={row.original.id}
            scopeLabel={`${row.original.factoryName} / ${row.original.departmentName} / ${row.original.name}`}
            scopeType="device"
          />
        ),
        header: 'Actions',
      },
    ],
    [],
  );

  return (
    <AccessControlShell
      currentTab="devices"
      description="Device-level viewer assignment. Direct device access grants read access to enabled apps under that device."
      navigation={data.navigation}
      stats={
        <>
          <StatCard
            description="Devices matching the active filter."
            title="Devices"
            value={data.stats.deviceCount}
          />
          <StatCard
            description="Devices marked active in visible scope."
            title="Active Devices"
            value={data.stats.activeDeviceCount}
          />
          <StatCard
            description="Enabled app installations in visible scope."
            title="Enabled Apps"
            value={data.stats.enabledAppCount}
          />
        </>
      }
      title="Device Permissions"
    >
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Device Scopes</CardTitle>
          <CardDescription>
            Paginated device viewer assignments with enabled-app counts and hierarchy context.
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
