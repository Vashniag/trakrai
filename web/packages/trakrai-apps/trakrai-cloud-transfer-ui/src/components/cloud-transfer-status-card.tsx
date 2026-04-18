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
import { getServiceStatusClasses } from '@trakrai/live-transport/lib/live-display-utils';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import {
  AUTO_REFRESH_MS,
  DEFAULT_SERVICE_NAME,
  formatTimestamp,
  readRequestErrorMessage,
} from './cloud-transfer-utils';

import type { CloudTransferStatusPayload } from '../types';

export type CloudTransferStatusCardProps = Readonly<{
  refreshKey?: number;
  serviceName?: string;
}>;

export const CloudTransferStatusCard = ({
  refreshKey = 0,
  serviceName = DEFAULT_SERVICE_NAME,
}: CloudTransferStatusCardProps) => {
  const normalizedServiceName = serviceName.trim();
  const transferService = useTypedDeviceService(cloud_transferContract, {
    serviceName: normalizedServiceName,
  });
  const { deviceStatus, transportState } = useLiveTransport();
  const serviceStatus = deviceStatus?.services?.[normalizedServiceName];
  const statusLabel = serviceStatus?.status ?? 'offline';
  const statusClasses = getServiceStatusClasses(statusLabel);
  const statusQuery = useDeviceServiceQuery(
    transferService,
    'get-status',
    {},
    {
      enabled: normalizedServiceName !== '',
      refetchInterval: transportState === 'connected' ? AUTO_REFRESH_MS : false,
      refetchIntervalInBackground: true,
    },
  );

  useEffect(() => {
    if (refreshKey === 0) {
      return;
    }

    void statusQuery.refetch();
  }, [refreshKey, statusQuery]);

  const error = statusQuery.error !== null ? readRequestErrorMessage(statusQuery.error) : null;
  const isBusy = statusQuery.isFetching;
  const lastRefreshedAt =
    statusQuery.dataUpdatedAt > 0 ? new Date(statusQuery.dataUpdatedAt).toISOString() : null;
  const status = (statusQuery.data ?? null) as CloudTransferStatusPayload | null;

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Cloud transfer queue</CardTitle>
            <CardDescription>
              Enqueue uploads and downloads against the device-side transfer service.
            </CardDescription>
          </div>
          <div
            className={`inline-flex items-center gap-2 border px-3 py-1 text-[10px] tracking-[0.2em] uppercase ${statusClasses}`}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            {statusLabel}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Shared directory
            </div>
            <div className="mt-1 text-sm font-medium break-all">{status?.sharedDir ?? 'N/A'}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Pending
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.pending ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Running
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.running ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Last refresh
            </div>
            <div className="mt-1 text-sm font-medium">
              {isBusy ? 'Refreshing...' : formatTimestamp(lastRefreshedAt)}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-6">
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Total
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.total ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Upload queued
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.uploadQueued ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Download queued
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.downloadQueued ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Uploads completed
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.uploadsCompleted ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Downloads completed
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.downloadsCompleted ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Failed
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.failed ?? 0}</div>
          </div>
        </div>

        {serviceStatus === undefined ? (
          <div className="text-muted-foreground border border-dashed px-4 py-3 text-sm">
            Cloud transfer service is not registered on this device yet.
          </div>
        ) : null}

        {error !== null ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
