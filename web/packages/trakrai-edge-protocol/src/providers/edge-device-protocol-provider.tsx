'use client';


import { DeviceRuntimeProvider } from '@trakrai/live-transport/providers/device-runtime-provider';
import { EdgeTransportProvider } from '@trakrai/live-transport/providers/live-transport-provider';
import { WebRtcConfigProvider } from '@trakrai/webrtc/providers/webrtc-config-provider';

import type { LiveTransportProviderProps } from '@trakrai/live-transport/providers/live-transport-provider';

export type EdgeDeviceProtocolProviderProps = LiveTransportProviderProps &
  Readonly<{
    iceTransportPolicy?: RTCIceTransportPolicy;
  }>;

export const EdgeDeviceProtocolProvider = ({
  children,
  iceTransportPolicy,
  ...transportProps
}: EdgeDeviceProtocolProviderProps) => (
  <EdgeTransportProvider {...transportProps}>
    <DeviceRuntimeProvider>
      <WebRtcConfigProvider iceTransportPolicy={iceTransportPolicy}>
        {children}
      </WebRtcConfigProvider>
    </DeviceRuntimeProvider>
  </EdgeTransportProvider>
);
