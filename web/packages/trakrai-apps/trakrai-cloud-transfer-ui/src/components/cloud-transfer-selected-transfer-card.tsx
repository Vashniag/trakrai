'use client';

import { useEffect } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { cloud_transferContract } from '@trakrai/live-transport/generated-contracts/cloud_transfer';
import {
  useDeviceServiceQuery,
  useTypedDeviceService,
} from '@trakrai/live-transport/hooks/use-typed-device-service';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import { DEFAULT_SERVICE_NAME, readRequestErrorMessage } from './cloud-transfer-utils';

import type { CloudTransferItem } from '../types';

export type CloudTransferSelectedTransferCardProps = Readonly<{
  refreshKey?: number;
  serviceName?: string;
  transferId: string | null;
}>;

export const CloudTransferSelectedTransferCard = ({
  refreshKey = 0,
  serviceName = DEFAULT_SERVICE_NAME,
  transferId,
}: CloudTransferSelectedTransferCardProps) => {
  const normalizedServiceName = serviceName.trim();
  const transferService = useTypedDeviceService(cloud_transferContract, {
    serviceName: normalizedServiceName,
  });
  const { transportState } = useLiveTransport();
  const normalizedTransferId = transferId?.trim() ?? '';
  const transferQuery = useDeviceServiceQuery(
    transferService,
    'get-transfer',
    { transferId: normalizedTransferId },
    {
      enabled:
        normalizedServiceName !== '' &&
        transportState === 'connected' &&
        normalizedTransferId !== '',
    },
  );

  useEffect(() => {
    if (refreshKey === 0 || normalizedTransferId === '') {
      return;
    }

    void transferQuery.refetch();
  }, [normalizedTransferId, refreshKey, transferQuery]);

  const error = transferQuery.error !== null ? readRequestErrorMessage(transferQuery.error) : null;
  const isBusy = transferQuery.isFetching;
  const transfer = (transferQuery.data?.transfer ?? null) as CloudTransferItem | null;

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Selected transfer</CardTitle>
        <CardDescription>Raw transfer record after querying the device queue.</CardDescription>
      </CardHeader>
      <CardContent>
        {error !== null ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        {isBusy ? <div className="text-muted-foreground text-sm">Loading transfer...</div> : null}

        {!isBusy && error === null && transfer !== null ? (
          <pre className="bg-muted overflow-x-auto border p-4 text-xs">
            {JSON.stringify(transfer, null, 2)}
          </pre>
        ) : null}

        {!isBusy && error === null && transfer === null ? (
          <div className="text-muted-foreground text-sm">
            Select a transfer to load its latest device-side record.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
