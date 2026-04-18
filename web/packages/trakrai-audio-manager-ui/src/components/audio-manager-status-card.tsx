'use client';

import { useEffect } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { audio_managerContract } from '@trakrai/live-transport/generated-contracts/audio_manager';
import {
  useDeviceServiceQuery,
  useTypedDeviceService,
} from '@trakrai/live-transport/hooks/use-typed-device-service';
import { getServiceStatusClasses } from '@trakrai/live-transport/lib/live-display-utils';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import {
  AUTO_REFRESH_MS,
  DEFAULT_SERVICE_NAME,
  formatBooleanLabel,
  formatTimestamp,
  readRequestErrorMessage,
} from './audio-manager-utils';

import type { AudioManagerStatusPayload } from '../types';

export type AudioManagerStatusCardProps = Readonly<{
  refreshKey?: number;
  serviceName?: string;
}>;

export const AudioManagerStatusCard = ({
  refreshKey = 0,
  serviceName = DEFAULT_SERVICE_NAME,
}: AudioManagerStatusCardProps) => {
  const normalizedServiceName = serviceName.trim();
  const audioService = useTypedDeviceService(audio_managerContract, {
    serviceName: normalizedServiceName,
  });
  const { deviceStatus, transportState } = useLiveTransport();
  const serviceStatus = deviceStatus?.services?.[normalizedServiceName];
  const statusLabel = serviceStatus?.status ?? 'offline';
  const statusClasses = getServiceStatusClasses(statusLabel);
  const statusQuery = useDeviceServiceQuery(
    audioService,
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
  const status = (statusQuery.data ?? null) as AudioManagerStatusPayload | null;

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Audio manager</CardTitle>
            <CardDescription>
              Queue device speech playback, inspect recent jobs, and review delivery backends.
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
              Queue depth
            </div>
            <div className="mt-1 text-sm font-medium">{status?.pendingQueueDepth ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Playback backend
            </div>
            <div className="mt-1 text-sm font-medium">{status?.playbackBackend ?? 'N/A'}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              TTS backend
            </div>
            <div className="mt-1 text-sm font-medium">{status?.ttsBackend ?? 'N/A'}</div>
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
              Queued
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.queued ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Processing
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.processing ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Completed
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.completed ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Deduped
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.deduped ?? 0}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Failed
            </div>
            <div className="mt-1 text-sm font-medium">{status?.stats.failed ?? 0}</div>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Speaker transport
            </div>
            <div className="mt-1 text-sm font-medium">{status?.speakerTransport ?? 'N/A'}</div>
            <div className="text-muted-foreground mt-2 text-xs">
              Speaker delivery: {formatBooleanLabel(status?.speakerEnabled ?? false)}
            </div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Device ID
            </div>
            <div className="mt-1 text-sm font-medium break-all">{status?.deviceId ?? 'N/A'}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Cache directory
            </div>
            <div className="mt-1 text-sm font-medium break-all">{status?.cacheDir ?? 'N/A'}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Event log path
            </div>
            <div className="mt-1 text-sm font-medium break-all">
              {status?.eventLogPath ?? 'N/A'}
            </div>
          </div>
        </div>

        {serviceStatus === undefined ? (
          <div className="text-muted-foreground border border-dashed px-4 py-3 text-sm">
            Audio manager is not registered on this device yet.
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
