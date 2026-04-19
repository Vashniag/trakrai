'use client';

import { useCallback, useMemo } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import { MutationModal } from '@trakrai/design-system/components/mutation-modal';

import {
  createDepartmentSchema,
  updateDepartmentSchema,
} from '@/app/(core)/access-control/_components/access-control-page-lib';
import { AccessControlScopeManagerModal } from '@/app/(core)/access-control/_components/access-control-scope-manager-modal';
import { AccessControlShell } from '@/app/(core)/access-control/_components/access-control-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { useTRPCMutation, useTRPCQuery } from '@/server/react';

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
  const router = useRouter();
  const factoryOptionsQuery = useTRPCQuery((api) => ({
    ...api.workspace.listFactoriesNav.queryOptions(),
    enabled: data.navigation.isSysadmin,
    retry: false,
  }));
  const createDepartmentMutation = useTRPCMutation((api) =>
    api.accessControl.createDepartment.mutationOptions(),
  );
  const updateDepartmentMutation = useTRPCMutation((api) =>
    api.accessControl.updateDepartment.mutationOptions(),
  );

  const refresh = useCallback(async () => {
    router.refresh();
  }, [router]);

  const factoryOptions = useMemo(
    () =>
      (factoryOptionsQuery.data ?? []).map((factoryRow) => ({
        label: factoryRow.name,
        value: factoryRow.id,
      })),
    [factoryOptionsQuery.data],
  );

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
        accessorKey: 'deviceCount',
        header: 'Devices',
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            {data.navigation.isSysadmin ? (
              <MutationModal
                defaultValues={{
                  description: row.original.description ?? '',
                  factoryId: row.original.factoryId,
                  id: row.original.id,
                  name: row.original.name,
                }}
                fields={[
                  { label: 'Name', name: 'name', type: 'input' },
                  {
                    label: 'Factory',
                    name: 'factoryId',
                    options: factoryOptions,
                    type: 'select',
                  },
                  { label: 'Description', name: 'description', type: 'textarea' },
                ]}
                mutation={updateDepartmentMutation}
                refresh={refresh}
                schema={updateDepartmentSchema}
                submitButtonText="Save department"
                successToast={() => 'Department updated.'}
                titleText="Edit department"
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
              scopeLabel={`${row.original.factoryName} / ${row.original.name}`}
              scopeType="department"
            />
          </div>
        ),
        header: 'Actions',
      },
    ],
    [
      data.filterOptions.factories,
      data.navigation.isSysadmin,
      factoryOptions,
      refresh,
      updateDepartmentMutation,
    ],
  );

  return (
    <AccessControlShell
      currentTab="departments"
      description="Department subtree delegation. Direct admins can manage users and downstream device or app permissions within their department."
      navigation={data.navigation}
      stats={
        <>
          <StatCard title="Departments" value={data.stats.departmentCount} />
          <StatCard title="Devices" value={data.stats.deviceCount} />
          <StatCard title="Active Devices" value={data.stats.activeDeviceCount} />
        </>
      }
      title="Departments"
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
                  description: '',
                  factoryId: factoryOptions[0]?.value ?? '',
                  name: '',
                }}
                fields={[
                  { label: 'Name', name: 'name', type: 'input' },
                  {
                    label: 'Factory',
                    name: 'factoryId',
                    options: factoryOptions,
                    type: 'select',
                  },
                  { label: 'Description', name: 'description', type: 'textarea' },
                ]}
                mutation={createDepartmentMutation}
                refresh={refresh}
                schema={createDepartmentSchema}
                submitButtonText="Create department"
                successToast={() => 'Department created.'}
                titleText="Create department"
                trigger={<Button type="button">Create department</Button>}
              />
            ) : undefined
          }
        />
      </section>
    </AccessControlShell>
  );
};
