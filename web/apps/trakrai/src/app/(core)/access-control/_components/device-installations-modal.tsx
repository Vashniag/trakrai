'use client';

import { useCallback, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@trakrai/design-system/components/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@trakrai/design-system/components/table';
import { toast } from 'sonner';

import { AccessControlScopeManagerModal } from '@/app/(core)/access-control/_components/access-control-scope-manager-modal';
import { useTRPCMutation, useTRPCQuery } from '@/server/react';

import type { RouterOutput } from '@trakrai/backend/server/routers';

type InstallationRow = RouterOutput['accessControl']['listDeviceInstallations']['rows'][number];

type Props = Readonly<{
  deviceId: string;
  deviceName: string;
  isSysadmin: boolean;
}>;

const roleOptions = [
  { label: 'Read', value: 'read' as const },
  { label: 'Write', value: 'write' as const },
];

export const DeviceInstallationsModal = ({ deviceId, deviceName, isSysadmin }: Props) => {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const setInstallationStateMutation = useTRPCMutation((api) =>
    api.accessControl.setInstallationState.mutationOptions(),
  );
  const installationsQuery = useTRPCQuery((api) => ({
    ...api.accessControl.listDeviceInstallations.queryOptions({ deviceId }),
    enabled: open,
    retry: false,
  }));
  const { refetch } = installationsQuery;

  const refresh = useCallback(async () => {
    router.refresh();
    await refetch();
  }, [refetch, router]);

  const installations = installationsQuery.data?.rows ?? [];

  const handleToggle = useCallback(
    async (installation: InstallationRow) => {
      try {
        await setInstallationStateMutation.mutateAsync({
          componentKey: installation.componentKey,
          deviceId,
          enabled: !installation.enabled,
        });
        toast.success(
          `${installation.componentDisplayName} ${installation.enabled ? 'disabled' : 'enabled'}.`,
        );
        await refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to update device app installation.',
        );
      }
    },
    [deviceId, refresh, setInstallationStateMutation],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          Apps
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{deviceName} apps</DialogTitle>
          <DialogDescription className="sr-only">{deviceName} app controls</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-auto border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {installationsQuery.isLoading ? (
                <TableRow>
                  <TableCell className="h-24 text-center" colSpan={4}>
                    Loading app installations...
                  </TableCell>
                </TableRow>
              ) : null}
              {installationsQuery.isError ? (
                <TableRow>
                  <TableCell className="h-24 text-center" colSpan={4}>
                    Failed to load app installations.
                  </TableCell>
                </TableRow>
              ) : null}
              {installations.map((installation) => (
                <TableRow key={installation.id}>
                  <TableCell className="font-medium">{installation.componentDisplayName}</TableCell>
                  <TableCell>{installation.serviceName}</TableCell>
                  <TableCell>{installation.enabled ? 'Enabled' : 'Disabled'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <AccessControlScopeManagerModal
                        roleOptions={roleOptions}
                        scopeId={installation.id}
                        scopeLabel={`${deviceName} / ${installation.componentDisplayName}`}
                        scopeType="component"
                        trigger={
                          <Button size="sm" type="button" variant="outline">
                            Access
                          </Button>
                        }
                      />
                      {isSysadmin ? (
                        <Button
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={() => {
                            void handleToggle(installation);
                          }}
                        >
                          {installation.enabled ? 'Disable' : 'Enable'}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!installationsQuery.isLoading &&
              !installationsQuery.isError &&
              installations.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center" colSpan={4}>
                    No app installations found.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
};
