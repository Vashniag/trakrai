'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

import { VideoPlayer } from './video-player';

import { useLiveStreamSession } from '../hooks/use-live-stream-session';
import { formatMetric, getStatusClasses } from '../lib/live-ui-utils';

type LiveStreamTileCardProps = Readonly<{
  cameraName: string;
  deviceId: string;
  enabled: boolean;
  httpBaseUrl: string;
  signalingUrl: string;
  slotLabel: string;
}>;

const getRouteLabel = (candidateType: string | null, transport: string | null): string => {
  if (candidateType === null && transport === null) {
    return 'N/A';
  }

  if (candidateType === null) {
    return transport ?? 'N/A';
  }

  return transport !== null ? `${candidateType} / ${transport}` : candidateType;
};

export const LiveStreamTileCard = ({
  cameraName,
  deviceId,
  enabled,
  httpBaseUrl,
  signalingUrl,
  slotLabel,
}: LiveStreamTileCardProps) => {
  const { activeCameraName, connectionState, error, stream, streamStats } = useLiveStreamSession({
    cameraName,
    deviceId,
    enabled,
    httpBaseUrl,
    signalingUrl,
  });

  const statusClasses = getStatusClasses(connectionState);
  const isTileActive = enabled && cameraName.trim() !== '';

  return (
    <Card className="border bg-neutral-950 text-white">
      <CardHeader className="border-b border-white/10 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-white">{activeCameraName ?? cameraName}</CardTitle>
            <CardDescription className="mt-1 text-white/55">{slotLabel}</CardDescription>
          </div>
          <div
            className={`inline-flex items-center gap-2 border px-3 py-1 text-[10px] tracking-[0.2em] uppercase ${statusClasses}`}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            {connectionState}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <VideoPlayer
          activeCameraName={activeCameraName ?? cameraName}
          connectionState={connectionState}
          isActive={isTileActive}
          stream={stream}
          streamStats={streamStats}
        />

        {error !== null && error !== '' ? (
          <div className="border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="border border-white/10 bg-white/5 p-3">
            <div className="text-[11px] tracking-[0.18em] text-white/45 uppercase">FPS</div>
            <div className="mt-1 text-sm font-medium text-white">
              {formatMetric(streamStats?.fps, '')}
            </div>
          </div>
          <div className="border border-white/10 bg-white/5 p-3">
            <div className="text-[11px] tracking-[0.18em] text-white/45 uppercase">Bitrate</div>
            <div className="mt-1 text-sm font-medium text-white">
              {formatMetric(streamStats?.bitrateKbps, ' kbps')}
            </div>
          </div>
          <div className="border border-white/10 bg-white/5 p-3">
            <div className="text-[11px] tracking-[0.18em] text-white/45 uppercase">Route</div>
            <div className="mt-1 text-sm font-medium text-white">
              {getRouteLabel(streamStats?.candidateType ?? null, streamStats?.transport ?? null)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
