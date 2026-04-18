'use client';

import { useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { cloud_transferContract } from '@trakrai/live-transport/generated-contracts/cloud_transfer';
import {
  useDeviceServiceMutation,
  useTypedDeviceService,
} from '@trakrai/live-transport/hooks/use-typed-device-service';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import {
  DEFAULT_SERVICE_NAME,
  createEmptyDownloadDraft,
  readRequestErrorMessage,
  toDownloadInput,
} from './cloud-transfer-utils';

import type { CloudTransferItem } from '../types';

export type EnqueueDownloadCardProps = Readonly<{
  onQueued?: (transfer: CloudTransferItem) => void;
  serviceName?: string;
}>;

export const EnqueueDownloadCard = ({
  onQueued,
  serviceName = DEFAULT_SERVICE_NAME,
}: EnqueueDownloadCardProps) => {
  const normalizedServiceName = serviceName.trim();
  const transferService = useTypedDeviceService(cloud_transferContract, {
    serviceName: normalizedServiceName,
  });
  const { appendLog, transportState } = useLiveTransport();
  const [draft, setDraft] = useState(createEmptyDownloadDraft);
  const enqueueDownloadMutation = useDeviceServiceMutation(transferService, 'enqueue-download', {
    onSuccess: (payload) => {
      appendLog('info', `Queued download ${payload.transfer.id}`);
      setDraft(createEmptyDownloadDraft());
      onQueued?.(payload.transfer);
      void transferService.invalidateQueries('get-status');
      void transferService.invalidateQueries('list-transfers');
      void transferService.invalidateQueries('get-transfer', {
        transferId: payload.transfer.id,
      });
    },
  });

  const handleSubmit = () => {
    if (normalizedServiceName === '' || transportState !== 'connected') {
      return;
    }

    enqueueDownloadMutation.reset();
    void enqueueDownloadMutation.mutateAsync(toDownloadInput(draft));
  };

  const error =
    enqueueDownloadMutation.error !== null
      ? readRequestErrorMessage(enqueueDownloadMutation.error)
      : null;
  const isBusy = enqueueDownloadMutation.isPending;

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Queue download</CardTitle>
        <CardDescription>
          Request a device-side download into a path relative to the shared directory.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="download-local-path">Local path</Label>
          <Input
            id="download-local-path"
            placeholder="manual-tests/downloaded.txt"
            value={draft.localPath}
            onChange={(event) => {
              setDraft((current) => ({ ...current, localPath: event.target.value }));
            }}
          />
          <p className="text-muted-foreground text-xs">
            Relative to the shared directory shown above. The file will be created there.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="download-remote-path">Remote path</Label>
          <Input
            id="download-remote-path"
            value={draft.remotePath}
            onChange={(event) => {
              setDraft((current) => ({ ...current, remotePath: event.target.value }));
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="download-timeout">Timeout</Label>
          <Input
            id="download-timeout"
            placeholder="4h or 1d"
            value={draft.timeout}
            onChange={(event) => {
              setDraft((current) => ({ ...current, timeout: event.target.value }));
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="download-metadata">Metadata JSON</Label>
          <textarea
            className="border-input bg-background min-h-28 w-full border px-3 py-2 text-sm"
            id="download-metadata"
            value={draft.metadata}
            onChange={(event) => {
              setDraft((current) => ({ ...current, metadata: event.target.value }));
            }}
          />
        </div>
        {error !== null ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}
        <Button
          disabled={isBusy || transportState !== 'connected'}
          type="button"
          onClick={handleSubmit}
        >
          Queue download
        </Button>
      </CardContent>
    </Card>
  );
};
