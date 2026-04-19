'use client';

import { useCallback, useMemo } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { toast } from 'sonner';

import { AccessControlScopeManagerModal } from '@/app/(core)/access-control/_components/access-control-scope-manager-modal';
import { AccessControlShell } from '@/app/(core)/access-control/_components/access-control-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { useTRPCMutation } from '@/server/react';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type AppsPageData = RouterOutput['accessControl']['listScopeApps'];
type AppRow = AppsPageData['table']['rows'][number];

const roleOptions = [
  { label: 'Read', value: 'read' as const },
  { label: 'Write', value: 'write' as const },
];

export const AccessControlAppsPage = ({ data }: Readonly<{ data: AppsPageData }>) => {
  const router = useRouter();
  const installationStateMutation = useTRPCMutation((api) =>
    api.accessControl.setInstallationState.mutationOptions(),
  );

  const refresh = useCallback(async () => {
    router.refresh();
  }, [router]);

  const handleToggleInstallation = useCallback(
    async (row: AppRow) => {
      try {
        await installationStateMutation.mutateAsync({
          componentKey: row.componentKey,
          deviceId: row.deviceId,
          enabled: !row.enabled,
        });
        toast.success(`${row.componentDisplayName} ${row.enabled ? 'disabled' : 'enabled'}.`);
        await refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to update app installation state.',
        );
      }
    },
    [installationStateMutation, refresh],
  );

  const columns = useMemo<ColumnDef<AppRow>[]>(
    () => [
      {
        accessorKey: 'componentDisplayName',
        id: 'name',
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-medium">{row.original.componentDisplayName}</div>
            <div className="text-muted-foreground text-xs">
              {row.original.factoryName} / {row.original.departmentName} / {row.original.deviceName}
            </div>
          </div>
        ),
        enableColumnFilter: true,
        header: 'Installation',
        meta: {
          label: 'App',
          placeholder: 'Search apps or devices',
          variant: 'text',
        },
      },
      {
        accessorKey: 'serviceName',
        header: 'Service',
      },
      {
        accessorKey: 'readCount',
        header: 'Readers',
      },
      {
        accessorKey: 'writeCount',
        header: 'Writers',
      },
      {
        accessorKey: 'enabled',
        cell: ({ row }) => (
          <span className="text-xs font-medium tracking-[0.18em] uppercase">
            {row.original.enabled ? 'Enabled' : 'Disabled'}
          </span>
        ),
        header: 'State',
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <AccessControlScopeManagerModal
              roleOptions={roleOptions}
              scopeId={row.original.id}
              scopeLabel={`${row.original.deviceName} / ${row.original.componentDisplayName}`}
              scopeType="component"
            />
            {data.navigation.isSysadmin ? (
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => {
                  void handleToggleInstallation(row.original);
                }}
              >
                {row.original.enabled ? 'Disable' : 'Enable'}
              </Button>
            ) : null}
          </div>
        ),
        header: 'Actions',
      },
    ],
    [data.navigation.isSysadmin, handleToggleInstallation],
  );

  return (
    <AccessControlShell
      currentTab="apps"
      description="Per-device app assignment surface. Disabled apps remain inaccessible even if users still hold read or write tuples."
      navigation={data.navigation}
      stats={
        <>
          <StatCard
            description="Device-app installations matching the active filter."
            title="Installations"
            value={data.stats.installationCount}
          />
          <StatCard
            description="Enabled installations in visible scope."
            title="Enabled"
            value={data.stats.enabledInstallationCount}
          />
          <StatCard
            description="Devices represented by visible installation scope."
            title="Devices"
            value={data.stats.deviceCount}
          />
        </>
      }
      title="App Permissions"
    >
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Device App Scopes</CardTitle>
          <CardDescription>
            Server-rendered installation directory with direct reader or writer counts and sysadmin
            enable toggles.
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
