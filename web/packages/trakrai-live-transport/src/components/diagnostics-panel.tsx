'use client';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Separator } from '@trakrai/design-system/components/separator';

import type { ActivityLogEntry, StreamStats } from '../lib/live-types';

import { formatMetric } from '../lib/live-display-utils';

type DiagnosticsPanelProps = Readonly<{
  logs: ActivityLogEntry[];
  onToggle: () => void;
  showDiagnostics: boolean;
  streamStats: StreamStats | null;
}>;

const getResolutionLabel = (streamStats: StreamStats | null): string =>
  streamStats?.frameWidth != null && streamStats.frameHeight != null
    ? `${streamStats.frameWidth}x${streamStats.frameHeight}`
    : 'N/A';

const getRouteLabel = (streamStats: StreamStats | null): string => {
  const routeSuffix =
    streamStats?.transport !== null && streamStats?.transport !== undefined
      ? ` / ${streamStats.transport}`
      : '';

  return `${streamStats?.candidateType ?? 'N/A'}${routeSuffix}`;
};

export const DiagnosticsPanel = ({
  logs,
  onToggle,
  showDiagnostics,
  streamStats,
}: DiagnosticsPanelProps) => (
  <Card className="border">
    <CardHeader className="border-b">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Diagnostics</CardTitle>
          <CardDescription>Real-time stream metrics and a rolling event log.</CardDescription>
        </div>
        <Button size="sm" type="button" variant="outline" onClick={onToggle}>
          {showDiagnostics ? 'Hide panel' : 'Show panel'}
        </Button>
      </div>
    </CardHeader>

    {showDiagnostics ? (
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Bitrate
            </div>
            <div className="mt-1 text-sm font-medium">
              {formatMetric(streamStats?.bitrateKbps, ' kbps')}
            </div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">FPS</div>
            <div className="mt-1 text-sm font-medium">{formatMetric(streamStats?.fps, '')}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Resolution
            </div>
            <div className="mt-1 text-sm font-medium">{getResolutionLabel(streamStats)}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">RTT</div>
            <div className="mt-1 text-sm font-medium">
              {formatMetric(streamStats?.roundTripTimeMs, ' ms')}
            </div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Jitter
            </div>
            <div className="mt-1 text-sm font-medium">
              {formatMetric(streamStats?.jitterMs, ' ms')}
            </div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Packet loss
            </div>
            <div className="mt-1 text-sm font-medium">
              {formatMetric(streamStats?.packetsLost, '')}
            </div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Codec
            </div>
            <div className="mt-1 text-sm font-medium">{streamStats?.codec ?? 'N/A'}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Route
            </div>
            <div className="mt-1 text-sm font-medium">{getRouteLabel(streamStats)}</div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
            Recent events
          </div>
          <div className="max-h-[320px] space-y-2 overflow-y-auto border p-3">
            {logs.length > 0 ? (
              logs.map((entry) => (
                <div key={entry.id} className="border-b pb-2 last:border-b-0 last:pb-0">
                  <div className="text-muted-foreground flex items-center justify-between gap-3 text-[11px] tracking-[0.18em] uppercase">
                    <span>{entry.level}</span>
                    <span>{new Date(entry.at).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-1 text-xs">{entry.message}</div>
                </div>
              ))
            ) : (
              <div className="text-muted-foreground text-xs">
                No diagnostics yet. Connect to a device to start logging events.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    ) : (
      <CardContent>
        <div className="text-muted-foreground border px-4 py-3 text-sm">
          Diagnostics are hidden. Use the toggle above to inspect stream stats and recent events.
        </div>
      </CardContent>
    )}
  </Card>
);
