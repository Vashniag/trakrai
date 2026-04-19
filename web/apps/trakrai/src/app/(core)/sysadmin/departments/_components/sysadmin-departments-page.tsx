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
  createDepartmentSchema,
  updateDepartmentSchema,
} from '@/app/(core)/access-control/_components/access-control-page-lib';
import { SysadminShell } from '@/app/(core)/sysadmin/_components/sysadmin-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { useTRPCMutation, useTRPCQuery } from '@/server/react';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type DepartmentsPageData = RouterOutput['workspace']['listSysadminDepartments'];
type DepartmentRow = DepartmentsPageData['table']['rows'][number];

export const SysadminDepartmentsPage = ({ data }: Readonly<{ data: DepartmentsPageData }>) => {
  const router = useRouter();
  const factoryOptionsQuery = useTRPCQuery((api) => ({
    ...api.workspace.listFactoriesNav.queryOptions(),
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
        accessorKey: 'deviceCount',
        header: 'Devices',
      },
      {
        accessorKey: 'activeDeviceCount',
        header: 'Active',
      },
      {
        id: 'actions',
        cell: ({ row }) => (
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
        ),
        header: 'Actions',
      },
    ],
    [factoryOptions, refresh, updateDepartmentMutation],
  );

  return (
    <SysadminShell
      currentTab="departments"
      description="Server-rendered department management with filterable tables and factory-aware edit flows."
      stats={
        <>
          <StatCard
            description="Departments matching the active server filter."
            title="Departments"
            value={data.stats.departmentCount}
          />
          <StatCard
            description="Devices registered under all departments."
            title="Devices"
            value={data.stats.deviceCount}
          />
          <StatCard
            description="Devices currently marked active."
            title="Active Devices"
            value={data.stats.activeDeviceCount}
          />
        </>
      }
      title="Departments"
    >
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Department Directory</CardTitle>
          <CardDescription>
            Search, paginate, and update departments without shipping the full hierarchy to the
            client.
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
            }
          />
        </CardContent>
      </Card>
    </SysadminShell>
  );
};
