'use client';

import { useEffect, useRef } from 'react';

type Props = Readonly<{
  isActive: boolean;
  stream: MediaStream | null;
}>;

export const VideoPlayer = ({ isActive, stream }: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current !== null) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[1.75rem] bg-black">
      <video ref={videoRef} autoPlay className="h-full w-full object-contain" muted playsInline />
      {!isActive ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] text-center text-sm text-white/65">
          <div className="space-y-2">
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
