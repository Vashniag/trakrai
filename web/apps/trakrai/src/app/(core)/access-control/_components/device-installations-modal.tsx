'use client';

import { useCallback } from 'react';

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
import { useTRPCMutation } from '@/server/react';

type InstallationRow = Readonly<{
  componentDisplayName: string;
  componentKey: string;
  deviceId: string;
  enabled: boolean;
  id: string;
  readCount: number;
  serviceName: string;
  writeCount: number;
}>;

type Props = Readonly<{
  deviceId: string;
  deviceName: string;
  installations: InstallationRow[];
  isSysadmin: boolean;
}>;

const roleOptions = [
  { label: 'Read', value: 'read' as const },
  { label: 'Write', value: 'write' as const },
];

export const DeviceInstallationsModal = ({
  deviceId,
  deviceName,
  installations,
  isSysadmin,
}: Props) => {
  const router = useRouter();
  const setInstallationStateMutation = useTRPCMutation((api) =>
    api.accessControl.setInstallationState.mutationOptions(),
  );

  const refresh = useCallback(async () => {
    router.refresh();
  }, [router]);

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
    <Dialog>
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
                <TableHead>Readers</TableHead>
                <TableHead>Writers</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {installations.map((installation) => (
                <TableRow key={installation.id}>
                  <TableCell className="font-medium">{installation.componentDisplayName}</TableCell>
                  <TableCell>{installation.serviceName}</TableCell>
                  <TableCell>{installation.enabled ? 'Enabled' : 'Disabled'}</TableCell>
                  <TableCell>{installation.readCount}</TableCell>
                  <TableCell>{installation.writeCount}</TableCell>
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
              {installations.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center" colSpan={6}>
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
