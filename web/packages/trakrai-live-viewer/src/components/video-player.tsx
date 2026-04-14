'use client';

import { useEffect, useRef } from 'react';

import type { ConnectionState, StreamStats } from '@trakrai/live-transport/lib/live-types';

type VideoPlayerProps = Readonly<{
  activeCameraName: string | null;
  connectionState: ConnectionState;
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
}: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) {
      return undefined;
    }

    video.srcObject = stream;
    if (stream === null) {
      video.pause();
      return undefined;
    }

    let disposed = false;

    const attemptPlayback = () => {
      void video.play().catch(() => {
        if (disposed) {
          return;
        }
      });
    };

    attemptPlayback();
    video.addEventListener('loadedmetadata', attemptPlayback);
    video.addEventListener('canplay', attemptPlayback);

    return () => {
      disposed = true;
      video.removeEventListener('loadedmetadata', attemptPlayback);
      video.removeEventListener('canplay', attemptPlayback);
    };
  }, [stream]);

  const resolution = formatResolution(streamStats);
  const bitrateLabel =
    streamStats !== null && streamStats.bitrateKbps !== null
      ? `${streamStats.bitrateKbps} kbps`
      : 'Waiting';

  return (
    <div className="bg-card relative aspect-video w-full overflow-hidden border">
      <video ref={videoRef} autoPlay className="h-full w-full object-contain" muted playsInline />

      <div className="from-card/95 via-card/70 text-foreground/75 pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b to-transparent p-4 text-[11px] tracking-[0.22em] uppercase">
        <div className="space-y-1">
          <div>{activeCameraName ?? 'No camera selected'}</div>
          <div className="text-muted-foreground">{connectionState}</div>
        </div>
        <div className="space-y-1 text-right">
          <div>{bitrateLabel}</div>
          <div className="text-muted-foreground">{resolution ?? 'No video stats yet'}</div>
        </div>
      </div>

      {!isActive ? (
        <div className="bg-background/80 absolute inset-0 flex items-center justify-center text-center text-sm">
          <div className="space-y-2 px-6">
            <p className="text-foreground text-lg font-semibold">No stream active</p>
            <p className="text-muted-foreground mx-auto max-w-sm">
              Pick a camera and start a live session to attach the remote WebRTC track.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
};
