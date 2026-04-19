'use client';

import { useCallback, useMemo } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import { MutationModal } from '@trakrai/design-system/components/mutation-modal';

import {
  createFactorySchema,
  updateFactorySchema,
} from '@/app/(core)/access-control/_components/access-control-page-lib';
import { AccessControlScopeManagerModal } from '@/app/(core)/access-control/_components/access-control-scope-manager-modal';
import { AccessControlShell } from '@/app/(core)/access-control/_components/access-control-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { useTRPCMutation } from '@/server/react';

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
  const router = useRouter();
  const createFactoryMutation = useTRPCMutation((api) =>
    api.accessControl.createFactory.mutationOptions(),
  );
  const updateFactoryMutation = useTRPCMutation((api) =>
    api.accessControl.updateFactory.mutationOptions(),
  );

  const refresh = useCallback(async () => {
    router.refresh();
  }, [router]);

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
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            {data.navigation.isSysadmin ? (
              <MutationModal
                defaultValues={{
                  description: row.original.description ?? '',
                  id: row.original.id,
                  name: row.original.name,
                }}
                fields={[
                  { label: 'Name', name: 'name', type: 'input' },
                  { label: 'Description', name: 'description', type: 'textarea' },
                ]}
                mutation={updateFactoryMutation}
                refresh={refresh}
                schema={updateFactorySchema}
                submitButtonText="Save factory"
                successToast={() => 'Factory updated.'}
                titleText="Edit factory"
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
              scopeLabel={row.original.name}
              scopeType="factory"
            />
          </div>
        ),
        header: 'Actions',
      },
    ],
    [data.navigation.isSysadmin, refresh, updateFactoryMutation],
  );

  return (
    <AccessControlShell
      currentTab="factories"
      description="Factory-level inherited access. Factory admins can delegate department, device, and app permissions down the subtree."
      navigation={data.navigation}
      stats={
        <>
          <StatCard title="Factories" value={data.stats.factoryCount} />
          <StatCard title="Departments" value={data.stats.departmentCount} />
          <StatCard title="Devices" value={data.stats.deviceCount} />
        </>
      }
      title="Factories"
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
                  name: '',
                }}
                fields={[
                  { label: 'Name', name: 'name', type: 'input' },
                  { label: 'Description', name: 'description', type: 'textarea' },
                ]}
                mutation={createFactoryMutation}
                refresh={refresh}
                schema={createFactorySchema}
                submitButtonText="Create factory"
                successToast={() => 'Factory created.'}
                titleText="Create factory"
                trigger={<Button type="button">Create factory</Button>}
              />
            ) : undefined
          }
        />
      </section>
    </AccessControlShell>
  );
};
