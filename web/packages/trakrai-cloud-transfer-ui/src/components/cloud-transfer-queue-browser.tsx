'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
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

import {
  AUTO_REFRESH_MS,
  DEFAULT_SERVICE_NAME,
  FILTER_DIRECTIONS,
  FILTER_STATES,
  formatTimestamp,
  formatTransferLabel,
  normalizeFilter,
  readRequestErrorMessage,
} from './cloud-transfer-utils';

import type {
  CloudTransferFilter,
  CloudTransferItem,
  TransferDirection,
  TransferState,
} from '../types';

export type CloudTransferQueueBrowserProps = Readonly<{
  onSelectTransfer?: (transferId: string) => void;
  refreshKey?: number;
  selectedTransferId?: string | null;
  serviceName?: string;
}>;

export const CloudTransferQueueBrowser = ({
  onSelectTransfer,
  refreshKey = 0,
  selectedTransferId = null,
  serviceName = DEFAULT_SERVICE_NAME,
}: CloudTransferQueueBrowserProps) => {
  const normalizedServiceName = serviceName.trim();
  const transferService = useTypedDeviceService(cloud_transferContract, {
    serviceName: normalizedServiceName,
  });
  const { transportState } = useLiveTransport();
  const [filter, setFilter] = useState<CloudTransferFilter>({
    direction: 'all',
    limit: 20,
    state: 'all',
  });
  const queryInput = useMemo(
    () =>
      normalizeFilter(filter) as {
        direction?: TransferDirection;
        limit?: number;
        state?: TransferState;
      },
    [filter],
  );
  const transfersQuery = useDeviceServiceQuery(transferService, 'list-transfers', queryInput, {
    enabled: normalizedServiceName !== '',
    refetchInterval: transportState === 'connected' ? AUTO_REFRESH_MS : false,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (refreshKey === 0) {
      return;
    }

    void transfersQuery.refetch();
  }, [refreshKey, transfersQuery]);

  const error =
    transfersQuery.error !== null ? readRequestErrorMessage(transfersQuery.error) : null;
  const isBusy = transfersQuery.isFetching;
  const lastRefreshedAt =
    transfersQuery.dataUpdatedAt > 0 ? new Date(transfersQuery.dataUpdatedAt).toISOString() : null;
  const transfers = (transfersQuery.data?.items ?? []) as CloudTransferItem[];

  const handleFilterChange = (patch: Partial<CloudTransferFilter>) => {
    setFilter((currentFilter) => ({
      ...currentFilter,
      ...patch,
    }));
  };

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Recent transfers</CardTitle>
            <CardDescription>
              Inspect current queue state and load detailed transfer records.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="border-input bg-background h-9 border px-3 text-sm"
              value={filter.direction ?? 'all'}
              onChange={(event) => {
                handleFilterChange({
                  direction: event.target.value as TransferDirection | 'all',
                });
              }}
            >
              {FILTER_DIRECTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select
              className="border-input bg-background h-9 border px-3 text-sm"
              value={filter.state ?? 'all'}
              onChange={(event) => {
                handleFilterChange({
                  state: event.target.value as TransferState | 'all',
                });
              }}
            >
              {FILTER_STATES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Button
              disabled={isBusy || transportState !== 'connected'}
              type="button"
              variant="outline"
              onClick={() => void transfersQuery.refetch()}
            >
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-muted-foreground text-xs">
          Last refresh: {isBusy ? 'Refreshing...' : formatTimestamp(lastRefreshedAt)}
        </div>

        {error !== null ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        <div className="space-y-2">
          {transfers.length > 0 ? (
            transfers.map((transfer) => (
              <button
                key={transfer.id}
                className={`w-full border px-4 py-3 text-left transition ${
                  selectedTransferId === transfer.id
                    ? 'border-primary/40 bg-primary/10'
                    : 'hover:bg-muted/40'
                }`}
                type="button"
                onClick={() => {
                  onSelectTransfer?.(transfer.id);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium break-all">{transfer.remotePath}</div>
                    <div className="text-muted-foreground mt-1 text-xs break-all">
                      {transfer.localPath}
                    </div>
                    <div className="text-muted-foreground mt-2 text-[11px] tracking-[0.18em] uppercase">
                      {formatTransferLabel(transfer)}
                    </div>
                  </div>
                  <div className="text-right text-[11px]">
                    <div>{formatTimestamp(transfer.updatedAt)}</div>
                    <div className="text-muted-foreground mt-1">{transfer.id}</div>
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="text-muted-foreground border px-4 py-3 text-sm">
              No transfers match the current filter.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
