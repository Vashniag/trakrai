'use client';

import type { ReactNode } from 'react';

import { useLiveTransport } from '@trakrai/live-transport/hooks/use-live-transport';
import { useWebRtcConfig } from '@trakrai/webrtc/hooks/use-webrtc-config';
import { WebRtcProvider } from '@trakrai/webrtc/providers/webrtc-provider';

export type LiveViewerProviderProps = Readonly<{
  children: ReactNode;
}>;

export const LiveViewerProvider = ({ children }: LiveViewerProviderProps) => {
  const { httpBaseUrl } = useLiveTransport();
  const { iceTransportPolicy } = useWebRtcConfig();

  return (
    <WebRtcProvider httpBaseUrl={httpBaseUrl} iceTransportPolicy={iceTransportPolicy}>
      {children}
    </WebRtcProvider>
  );
};
