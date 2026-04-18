'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
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
  AUTO_REFRESH_MS,
  DEFAULT_SERVICE_NAME,
  FILTER_DIRECTIONS,
  FILTER_STATES,
  RESPONSE_SUBTOPIC,
  formatTimestamp,
  formatTransferLabel,
  normalizeFilter,
  readRequestErrorMessage,
} from './cloud-transfer-utils';

import type {
  CloudTransferFilter,
  CloudTransferItem,
  CloudTransferTransferListPayload,
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
  const transferService = useDeviceService(normalizedServiceName);
  const { transportState } = useLiveTransport();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CloudTransferFilter>({
    direction: 'all',
    limit: 20,
    state: 'all',
  });
  const [isBusy, setIsBusy] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<CloudTransferItem[]>([]);

  const refresh = useCallback(
    async (nextFilter: CloudTransferFilter = filter) => {
      if (normalizedServiceName === '' || transportState !== 'connected') {
        return;
      }

      setError(null);
      setIsBusy(true);

      try {
        const response = await transferService.request<
          { direction?: TransferDirection; limit?: number; state?: TransferState },
          CloudTransferTransferListPayload
        >('list-transfers', normalizeFilter(nextFilter), {
          responseSubtopics: [RESPONSE_SUBTOPIC],
          responseTypes: ['cloud-transfer-list'],
        });

        setTransfers(response.payload.items);
        setLastRefreshedAt(new Date().toISOString());
        setIsBusy(false);
      } catch (nextError) {
        setError(readRequestErrorMessage(nextError));
        setIsBusy(false);
      }
    },
    [filter, normalizedServiceName, transferService, transportState],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [refresh, refreshKey]);

  useEffect(() => {
    if (normalizedServiceName === '' || transportState !== 'connected') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [normalizedServiceName, refresh, transportState]);

  const handleFilterChange = (patch: Partial<CloudTransferFilter>) => {
    const nextFilter = {
      ...filter,
      ...patch,
    };
    setFilter(nextFilter);
    void refresh(nextFilter);
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
              onClick={() => void refresh()}
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
