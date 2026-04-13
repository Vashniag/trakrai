'use client';

import { useEffect, useRef } from 'react';

import type { StreamStats } from './use-device-stream';

type Props = Readonly<{
  activeCameraName: string | null;
  connectionState: string;
  isActive: boolean;
  stream: MediaStream | null;
  streamStats: StreamStats | null;
}>;

const formatResolution = (streamStats: StreamStats | null): string | null => {
  if (streamStats === null) {
    return null;
  }

  if (streamStats.frameWidth == null || streamStats.frameHeight == null) {
    return null;
  }

  return `${streamStats.frameWidth}x${streamStats.frameHeight}`;
};

export const VideoPlayer = ({
  activeCameraName,
  connectionState,
  isActive,
  stream,
  streamStats,
}: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current !== null) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const resolution = formatResolution(streamStats);
  const bitrateLabel =
    streamStats !== null && streamStats.bitrateKbps !== null
      ? `${streamStats.bitrateKbps} kbps`
      : 'Waiting';

  return (
    <div className="relative aspect-video w-full overflow-hidden border bg-black">
      <video ref={videoRef} autoPlay className="h-full w-full object-contain" muted playsInline />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 via-black/20 to-transparent p-4 text-[11px] tracking-[0.22em] text-white/75 uppercase">
        <div className="space-y-1">
          <div>{activeCameraName ?? 'No camera selected'}</div>
          <div className="text-white/50">{connectionState}</div>
        </div>
        <div className="space-y-1 text-right">
          <div>{bitrateLabel}</div>
          <div className="text-white/50">{resolution ?? 'No video stats yet'}</div>
        </div>
      </div>

      {!isActive ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.16),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] text-center text-sm text-white/70">
          <div className="space-y-2 px-6">
            <p className="text-lg font-semibold text-white">No stream active</p>
            <p className="mx-auto max-w-sm text-white/55">
              Pick a camera and start a live session to attach the remote WebRTC track.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
};
