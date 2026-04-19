'use client';

import { Badge } from '@trakrai/design-system/components/badge';
import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
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
  <Card className="border">
    <CardHeader className="border-b">
      <CardTitle className="text-base">Device app installations</CardTitle>
      <CardDescription>
        Sysadmin enable or disable each app per device. Disabled apps stay inaccessible even if
        assigned.
      </CardDescription>
    </CardHeader>
    <CardContent className="py-6">
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
    </CardContent>
  </Card>
);
