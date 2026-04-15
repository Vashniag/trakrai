'use client';


import { DeviceRuntimeProvider } from '@trakrai/live-transport/providers/device-runtime-provider';
import { CloudTransportProvider } from '@trakrai/live-transport/providers/live-transport-provider';
import { WebRtcConfigProvider } from '@trakrai/webrtc/providers/webrtc-config-provider';

import type { LiveTransportProviderProps } from '@trakrai/live-transport/providers/live-transport-provider';

export type CloudDeviceProtocolProviderProps = LiveTransportProviderProps &
  Readonly<{
    iceTransportPolicy?: RTCIceTransportPolicy;
  }>;

export const CloudDeviceProtocolProvider = ({
  children,
  iceTransportPolicy,
  ...transportProps
}: CloudDeviceProtocolProviderProps) => (
  <CloudTransportProvider {...transportProps}>
    <DeviceRuntimeProvider>
      <WebRtcConfigProvider iceTransportPolicy={iceTransportPolicy}>
        {children}
      </WebRtcConfigProvider>
    </DeviceRuntimeProvider>
  </CloudTransportProvider>
);
