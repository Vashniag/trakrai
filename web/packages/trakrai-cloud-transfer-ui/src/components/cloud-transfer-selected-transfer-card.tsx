'use client';

import { useEffect, useState } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { useDeviceService } from '@trakrai/live-transport/hooks/use-device-service';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import {
  DEFAULT_SERVICE_NAME,
  RESPONSE_SUBTOPIC,
  TRANSFER_RESPONSE_TYPES,
  readRequestErrorMessage,
} from './cloud-transfer-utils';

import type { CloudTransferItem, CloudTransferTransferPayload } from '../types';

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
  const transferService = useDeviceService(normalizedServiceName);
  const { transportState } = useLiveTransport();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [transfer, setTransfer] = useState<CloudTransferItem | null>(null);

  useEffect(() => {
    if (
      normalizedServiceName === '' ||
      transportState !== 'connected' ||
      transferId === null ||
      transferId.trim() === ''
    ) {
      if (transferId === null || transferId.trim() === '') {
        const timer = window.setTimeout(() => {
          setTransfer(null);
          setError(null);
        }, 0);

        return () => {
          window.clearTimeout(timer);
        };
      }
      return;
    }

    const loadTransfer = async () => {
      try {
        setError(null);
        setIsBusy(true);

        const response = await transferService.request<
          { transferId: string },
          CloudTransferTransferPayload
        >(
          'get-transfer',
          { transferId: transferId.trim() },
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: TRANSFER_RESPONSE_TYPES,
          },
        );

        setTransfer(response.payload.transfer);
        setIsBusy(false);
      } catch (nextError) {
        setError(readRequestErrorMessage(nextError));
        setIsBusy(false);
      }
    };

    void loadTransfer();
  }, [normalizedServiceName, refreshKey, transferId, transferService, transportState]);

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
