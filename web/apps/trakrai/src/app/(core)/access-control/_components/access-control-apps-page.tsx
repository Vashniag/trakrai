'use client';

import { useCallback, useMemo } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import { type FormField } from '@trakrai/design-system/components/dynamic-form-fields';
import { MutationModal } from '@trakrai/design-system/components/mutation-modal';
import { type z } from 'zod';

import { catalogSchema } from '@/app/(core)/access-control/_components/access-control-page-lib';
import { AccessControlShell } from '@/app/(core)/access-control/_components/access-control-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { useTRPCMutation } from '@/server/react';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type AppsPageData = RouterOutput['accessControl']['listScopeApps'];
type AppRow = AppsPageData['table']['rows'][number];
type CatalogFormValues = z.input<typeof catalogSchema>;

const catalogFields: Array<FormField<CatalogFormValues>> = [
  { label: 'Catalog key', name: 'key', type: 'input' as const },
  { label: 'Display name', name: 'displayName', type: 'input' as const },
  { label: 'Navigation label', name: 'navigationLabel', type: 'input' as const },
  { label: 'Service name', name: 'serviceName', type: 'input' as const },
  { label: 'Renderer key', name: 'rendererKey', type: 'input' as const },
  { label: 'Route path', name: 'routePath', type: 'input' as const },
  { label: 'Read actions', name: 'readActions', type: 'stringArray' as const },
  { label: 'Write actions', name: 'writeActions', type: 'stringArray' as const },
  { label: 'Sort order', name: 'sortOrder', type: 'number' as const },
  { label: 'Default enabled', name: 'defaultEnabled', type: 'checkbox' as const },
  { label: 'Description', name: 'description', type: 'textarea' as const },
];

export const AccessControlAppsPage = ({ data }: Readonly<{ data: AppsPageData }>) => {
  const router = useRouter();
  const createCatalogMutation = useTRPCMutation((api) =>
    api.accessControl.createCatalogEntry.mutationOptions(),
  );
  const updateCatalogMutation = useTRPCMutation((api) =>
    api.accessControl.updateCatalogEntry.mutationOptions(),
  );

  const refresh = useCallback(async () => {
    router.refresh();
  }, [router]);

  const columns = useMemo<ColumnDef<AppRow>[]>(
    () => [
      {
        accessorKey: 'displayName',
        id: 'name',
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-medium">{row.original.displayName}</div>
            <div className="text-muted-foreground text-xs">{row.original.key}</div>
          </div>
        ),
        enableColumnFilter: true,
        header: 'App',
        meta: {
          label: 'App',
          placeholder: 'Search apps',
          variant: 'text',
        },
      },
      {
        accessorKey: 'serviceName',
        header: 'Service',
      },
      {
        accessorKey: 'routePath',
        cell: ({ row }) => row.original.routePath ?? 'No route',
        header: 'Route',
      },
      {
        accessorKey: 'enabledInstallCount',
        header: 'Enabled On',
      },
      {
        accessorKey: 'installCount',
        header: 'Installed On',
      },
      {
        accessorKey: 'defaultEnabled',
        cell: ({ row }) => (
          <span className="text-xs font-medium tracking-[0.18em] uppercase">
            {row.original.defaultEnabled ? 'Enabled' : 'Opt-in'}
          </span>
        ),
        header: 'Default',
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          data.navigation.isSysadmin ? (
            <MutationModal
              defaultValues={{
                defaultEnabled: row.original.defaultEnabled,
                description: row.original.description ?? '',
                displayName: row.original.displayName,
                key: row.original.key,
                navigationLabel: row.original.navigationLabel,
                readActions: row.original.readActions,
                rendererKey: row.original.rendererKey ?? '',
                routePath: row.original.routePath ?? '',
                serviceName: row.original.serviceName,
                sortOrder: row.original.sortOrder,
                writeActions: row.original.writeActions,
              }}
              fields={catalogFields}
              mutation={updateCatalogMutation}
              refresh={refresh}
              schema={catalogSchema}
              submitButtonText="Save app"
              successToast={() => 'App updated.'}
              titleText="Edit app"
              trigger={
                <Button size="sm" type="button" variant="outline">
                  Edit
                </Button>
              }
            />
          ) : null
        ),
        header: 'Actions',
      },
    ],
    [data.navigation.isSysadmin, refresh, updateCatalogMutation],
  );

  return (
    <AccessControlShell
      currentTab="apps"
      description="Device app catalog."
      navigation={data.navigation}
      stats={
        <>
          <StatCard title="Apps" value={data.stats.appCount} />
          <StatCard title="Installations" value={data.stats.installationCount} />
          <StatCard title="Enabled" value={data.stats.enabledInstallationCount} />
        </>
      }
      title="Apps"
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
                    defaultEnabled: true,
                    description: '',
                    displayName: '',
                    key: '',
                    navigationLabel: '',
                    readActions: [],
                    rendererKey: '',
                    routePath: '',
                    serviceName: '',
                    sortOrder: data.stats.appCount,
                    writeActions: [],
                  }}
                  fields={catalogFields}
                  mutation={createCatalogMutation}
                  refresh={refresh}
                  schema={catalogSchema}
                  submitButtonText="Register app"
                  successToast={() => 'App registered.'}
                  titleText="Register app"
                  trigger={<Button type="button">Register app</Button>}
                />
              ) : undefined
            }
          />
      </section>
    </AccessControlShell>
  );
};
