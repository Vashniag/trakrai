'use client';

import { Badge } from '@trakrai/design-system/components/badge';
import { Button } from '@trakrai/design-system/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@trakrai/design-system/components/table';
import { toast } from 'sonner';

import type {
  InstallationStateValues,
  InstallationTableRow,
  MutationLike,
} from './access-control-page-lib';

type Props = {
  installationRows: InstallationTableRow[];
  isSysadmin: boolean;
  refreshConsole: () => Promise<void>;
  setInstallationStateMutation: MutationLike<InstallationStateValues>;
};

export const AccessControlDeviceAppInstallationsSection = ({
  installationRows,
  isSysadmin,
  refreshConsole,
  setInstallationStateMutation,
}: Props) => (
  <section className="space-y-4 border p-6">
    <h2 className="text-base font-semibold tracking-tight">Device app installations</h2>
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
            <TableHead>Device app</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {installationRows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.deviceName}</TableCell>
              <TableCell>{row.componentDisplayName}</TableCell>
              <TableCell>
                <Badge variant={row.enabled ? 'secondary' : 'outline'}>
                  {row.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </TableCell>
              <TableCell>
                {isSysadmin ? (
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void setInstallationStateMutation
                        .mutateAsync({
                          componentKey: row.componentKey,
                          deviceId: row.deviceId,
                          enabled: !row.enabled,
                        })
                        .then(() => {
                          toast.success(
                            `${row.componentDisplayName} ${row.enabled ? 'disabled' : 'enabled'}.`,
                          );
                          return refreshConsole();
                        })
                        .catch((error) => {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : 'Failed to update installation.',
                          );
                        });
                    }}
                  >
                    {row.enabled ? 'Disable' : 'Enable'}
                  </Button>
                ) : (
                  <span className="text-muted-foreground text-xs">Read only</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </section>
);
