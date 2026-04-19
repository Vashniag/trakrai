'use client';

import { useCallback, useMemo } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import { MutationModal } from '@trakrai/design-system/components/mutation-modal';
import { z } from 'zod';

import { SysadminShell } from '@/app/(core)/sysadmin/_components/sysadmin-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { useTRPCMutation, useTRPCQuery } from '@/server/react';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type DevicesPageData = RouterOutput['workspace']['listSysadminDevices'];
type DeviceRow = DevicesPageData['table']['rows'][number];

const deviceCreateSchema = z.object({
  departmentId: z.string().trim().min(1),
  description: z.string(),
  name: z.string().trim().min(1),
});

const deviceUpdateSchema = deviceCreateSchema.extend({
  id: z.string().trim().min(1),
  isActive: z.boolean(),
});

export const SysadminDevicesPage = ({ data }: Readonly<{ data: DevicesPageData }>) => {
  const router = useRouter();
  const departmentOptionsQuery = useTRPCQuery((api) => ({
    ...api.workspace.listDepartmentOptions.queryOptions(),
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
        ),
        header: 'Actions',
      },
    ],
    [departmentOptions, refresh, updateDeviceMutation],
  );

  return (
    <SysadminShell
      currentTab="devices"
      description="Server-side device inventory for high-volume browsing, with app counts and scoped edit flows."
      stats={
        <>
          <StatCard
            description="Devices currently matching the active filter."
            title="Devices"
            value={data.stats.deviceCount}
          />
          <StatCard
            description="Devices flagged active in the registry."
            title="Active Devices"
            value={data.stats.activeDeviceCount}
          />
          <StatCard
            description="Enabled app installations across all devices."
            title="Enabled Apps"
            value={data.stats.enabledAppCount}
          />
        </>
      }
      title="Devices"
    >
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden border">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Device Inventory</h2>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-6">
          <ServerDataTable
            columns={columns}
            data={data.table.rows}
            pageCount={data.table.pageCount}
            toolbarChildren={
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
            }
          />
        </div>
      </section>
    </SysadminShell>
  );
};
