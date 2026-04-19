'use client';

import { useCallback, useMemo } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import { MutationModal } from '@trakrai/design-system/components/mutation-modal';
import { z } from 'zod';

import { AccessControlScopeManagerModal } from '@/app/(core)/access-control/_components/access-control-scope-manager-modal';
import { AccessControlShell } from '@/app/(core)/access-control/_components/access-control-shell';
import { DeviceInstallationsModal } from '@/app/(core)/access-control/_components/device-installations-modal';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { useTRPCMutation, useTRPCQuery } from '@/server/react';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type DevicesPageData = RouterOutput['accessControl']['listScopeDevices'];
type DeviceRow = DevicesPageData['table']['rows'][number];

const roleOptions = [{ label: 'Viewer', value: 'viewer' as const }];

const deviceCreateSchema = z.object({
  departmentId: z.string().trim().min(1),
  description: z.string(),
  name: z.string().trim().min(1),
});

const deviceUpdateSchema = deviceCreateSchema.extend({
  id: z.string().trim().min(1),
  isActive: z.boolean(),
});

export const AccessControlDevicesPage = ({
  data,
}: Readonly<{
  data: DevicesPageData;
}>) => {
  const router = useRouter();
  const departmentOptionsQuery = useTRPCQuery((api) => ({
    ...api.workspace.listDepartmentOptions.queryOptions(),
    enabled: data.navigation.isSysadmin,
    retry: false,
  }));
  const createDeviceMutation = useTRPCMutation((api) => api.devices.create.mutationOptions());
  const updateDeviceMutation = useTRPCMutation((api) => api.devices.update.mutationOptions());

  const refresh = useCallback(async () => {
    router.refresh();
  }, [router]);

  const departmentOptions = useMemo(
    () =>
      (departmentOptionsQuery.data ?? []).map((departmentRow) => ({
        label: `${departmentRow.factoryName} / ${departmentRow.name}`,
        value: departmentRow.id,
      })),
    [departmentOptionsQuery.data],
  );

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
        accessorKey: 'factoryId',
        cell: ({ row }) => row.original.factoryName,
        enableColumnFilter: true,
        header: 'Factory',
        meta: {
          label: 'Factory',
          options: data.filterOptions.factories,
          variant: 'select',
        },
      },
      {
        accessorKey: 'departmentId',
        cell: ({ row }) => row.original.departmentName,
        enableColumnFilter: true,
        header: 'Department',
        meta: {
          label: 'Department',
          options: data.filterOptions.departments,
          variant: 'select',
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
          <div className="flex flex-wrap gap-2">
            {data.navigation.isSysadmin ? (
              <MutationModal
                defaultValues={{
                  departmentId: row.original.departmentId,
                  description: row.original.description ?? '',
                  id: row.original.id,
                  isActive: row.original.isActive,
                  name: row.original.name,
                }}
                fields={[
                  { label: 'Name', name: 'name', type: 'input' },
                  {
                    label: 'Department',
                    name: 'departmentId',
                    options: departmentOptions,
                    type: 'select',
                  },
                  { label: 'Description', name: 'description', type: 'textarea' },
                  { label: 'Active', name: 'isActive', type: 'checkbox' },
                ]}
                mutation={updateDeviceMutation}
                refresh={refresh}
                schema={deviceUpdateSchema}
                submitButtonText="Save device"
                successToast={() => 'Device updated.'}
                titleText="Edit device"
                trigger={
                  <Button size="sm" type="button" variant="outline">
                    Edit
                  </Button>
                }
              />
            ) : null}
            <AccessControlScopeManagerModal
              roleOptions={roleOptions}
              scopeId={row.original.id}
              scopeLabel={`${row.original.factoryName} / ${row.original.departmentName} / ${row.original.name}`}
              scopeType="device"
            />
            <DeviceInstallationsModal
              deviceId={row.original.id}
              deviceName={row.original.name}
              isSysadmin={data.navigation.isSysadmin}
            />
          </div>
        ),
        header: 'Actions',
      },
    ],
    [
      data.filterOptions.departments,
      data.filterOptions.factories,
      data.navigation.isSysadmin,
      departmentOptions,
      refresh,
      updateDeviceMutation,
    ],
  );

  return (
    <AccessControlShell
      currentTab="devices"
      description="Unified device management with hierarchy filters, direct viewer assignment, and per-device app controls."
      navigation={data.navigation}
      stats={
        <>
          <StatCard title="Devices" value={data.stats.deviceCount} />
          <StatCard title="Active Devices" value={data.stats.activeDeviceCount} />
          <StatCard title="Enabled Apps" value={data.stats.enabledAppCount} />
        </>
      }
      title="Devices"
    >
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden border px-6 py-6">
        <ServerDataTable
          columns={columns}
          data={data.table.rows}
          pageCount={data.table.pageCount}
          toolbarChildren={
            data.navigation.isSysadmin ? (
              <MutationModal
                defaultValues={{
                  departmentId: departmentOptions[0]?.value ?? '',
                  description: '',
                  name: '',
                }}
                fields={[
                  { label: 'Name', name: 'name', type: 'input' },
                  {
                    label: 'Department',
                    name: 'departmentId',
                    options: departmentOptions,
                    type: 'select',
                  },
                  { label: 'Description', name: 'description', type: 'textarea' },
                ]}
                mutation={createDeviceMutation}
                refresh={refresh}
                schema={deviceCreateSchema}
                submitButtonText="Create device"
                successToast={() => 'Device created.'}
                titleText="Create device"
                trigger={<Button type="button">Create device</Button>}
              />
            ) : undefined
          }
        />
      </section>
    </AccessControlShell>
  );
};
