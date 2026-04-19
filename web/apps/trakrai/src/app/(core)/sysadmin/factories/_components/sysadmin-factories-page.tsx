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
import { SysadminShell } from '@/app/(core)/sysadmin/_components/sysadmin-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { useTRPCMutation } from '@/server/react';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type FactoriesPageData = RouterOutput['workspace']['listSysadminFactories'];
type FactoryRow = FactoriesPageData['table']['rows'][number];

export const SysadminFactoriesPage = ({ data }: Readonly<{ data: FactoriesPageData }>) => {
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
        id: 'actions',
        cell: ({ row }) => (
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
        ),
        header: 'Actions',
      },
    ],
    [refresh, updateFactoryMutation],
  );

  return (
    <SysadminShell
      currentTab="factories"
      description="Paginated factory management with server-side search and aggregate hierarchy counts."
      stats={
        <>
          <StatCard title="Factories" value={data.stats.factoryCount} />
          <StatCard title="Departments" value={data.stats.departmentCount} />
          <StatCard title="Devices" value={data.stats.deviceCount} />
        </>
      }
      title="Factories"
    >
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden border">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Factory Directory</h2>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-6">
          <ServerDataTable
            columns={columns}
            data={data.table.rows}
            pageCount={data.table.pageCount}
            toolbarChildren={
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
            }
          />
        </div>
      </section>
    </SysadminShell>
  );
};
