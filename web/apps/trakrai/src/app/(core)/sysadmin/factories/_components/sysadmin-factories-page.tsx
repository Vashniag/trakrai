'use client';

import { useCallback, useMemo } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
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
          <StatCard
            description="Factories currently matching the active filter."
            title="Factories"
            value={data.stats.factoryCount}
          />
          <StatCard
            description="Departments across the entire hierarchy."
            title="Departments"
            value={data.stats.departmentCount}
          />
          <StatCard
            description="Devices registered under all factories."
            title="Devices"
            value={data.stats.deviceCount}
          />
        </>
      }
      title="Factories"
    >
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Factory Directory</CardTitle>
          <CardDescription>
            High-volume factory management with a server-rendered table shell.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
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
        </CardContent>
      </Card>
    </SysadminShell>
  );
};
