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
  createEmptyUploadDraft,
  readRequestErrorMessage,
  toUploadInput,
} from './cloud-transfer-utils';

import type { CloudTransferItem } from '../types';

export type EnqueueUploadCardProps = Readonly<{
  onQueued?: (transfer: CloudTransferItem) => void;
  serviceName?: string;
}>;

export const EnqueueUploadCard = ({
  onQueued,
  serviceName = DEFAULT_SERVICE_NAME,
}: EnqueueUploadCardProps) => {
  const normalizedServiceName = serviceName.trim();
  const transferService = useTypedDeviceService(cloud_transferContract, {
    serviceName: normalizedServiceName,
  });
  const { appendLog, transportState } = useLiveTransport();
  const [draft, setDraft] = useState(createEmptyUploadDraft);
  const enqueueUploadMutation = useDeviceServiceMutation(transferService, 'enqueue-upload', {
    onSuccess: (payload) => {
      appendLog('info', `Queued upload ${payload.transfer.id}`);
      setDraft(createEmptyUploadDraft());
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

    enqueueUploadMutation.reset();
    void enqueueUploadMutation.mutateAsync(toUploadInput(draft));
  };

  const error =
    enqueueUploadMutation.error !== null
      ? readRequestErrorMessage(enqueueUploadMutation.error)
      : null;
  const isBusy = enqueueUploadMutation.isPending;

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Queue upload</CardTitle>
        <CardDescription>
          Provide a path relative to the device shared directory and the remote object path.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="upload-local-path">Local path</Label>
          <Input
            id="upload-local-path"
            placeholder="manual-tests/sample.txt"
            value={draft.localPath}
            onChange={(event) => {
              setDraft((current) => ({ ...current, localPath: event.target.value }));
            }}
          />
          <p className="text-muted-foreground text-xs">
            Relative to the shared directory shown above. Absolute host paths will be rejected.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="upload-remote-path">Remote path</Label>
          <Input
            id="upload-remote-path"
            value={draft.remotePath}
            onChange={(event) => {
              setDraft((current) => ({ ...current, remotePath: event.target.value }));
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="upload-content-type">Content type</Label>
            <Input
              id="upload-content-type"
              value={draft.contentType}
              onChange={(event) => {
                setDraft((current) => ({ ...current, contentType: event.target.value }));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="upload-timeout">Timeout</Label>
            <Input
              id="upload-timeout"
              placeholder="4h or 1d"
              value={draft.timeout}
              onChange={(event) => {
                setDraft((current) => ({ ...current, timeout: event.target.value }));
              }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="upload-metadata">Metadata JSON</Label>
          <textarea
            className="border-input bg-background min-h-28 w-full border px-3 py-2 text-sm"
            id="upload-metadata"
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
          onClick={() => {
            handleSubmit();
          }}
        >
          Queue upload
        </Button>
      </CardContent>
    </Card>
  );
};
