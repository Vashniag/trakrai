'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  DEFAULT_WEBRTC_CLIENT_CONFIG,
  type WebRtcClientConfig,
} from '../lib/webrtc-client-config';

export type WebRtcConfigProviderProps = Readonly<{
  children: ReactNode;
  iceTransportPolicy?: RTCIceTransportPolicy;
}>;

const WebRtcConfigContext = createContext<WebRtcClientConfig>(DEFAULT_WEBRTC_CLIENT_CONFIG);

export const WebRtcConfigProvider = ({
  children,
  iceTransportPolicy = DEFAULT_WEBRTC_CLIENT_CONFIG.iceTransportPolicy,
}: WebRtcConfigProviderProps) => {
  const value = useMemo<WebRtcClientConfig>(
    () => ({
      iceTransportPolicy,
    }),
    [iceTransportPolicy],
  );

  return <WebRtcConfigContext.Provider value={value}>{children}</WebRtcConfigContext.Provider>;
};

export const useWebRtcConfigContext = (): WebRtcClientConfig => useContext(WebRtcConfigContext);
