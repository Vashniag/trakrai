'use client';

import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';
import { DeviceLivePage } from '@trakrai/live-ui/components/device-live-page';
import { WebRtcProvider } from '@trakrai/webrtc/providers/webrtc-provider';

import {
  CloudConsoleSurface,
  cloudGatewayIceTransportPolicy,
} from '@/components/cloud-console-surface';

const CloudLiveRoute = () => {
  const { httpBaseUrl } = useLiveTransport();

  return (
    <WebRtcProvider httpBaseUrl={httpBaseUrl} iceTransportPolicy={cloudGatewayIceTransportPolicy}>
      <DeviceLivePage />
    </WebRtcProvider>
  );
};

const LivePage = () => (
  <CloudConsoleSurface
    description="Focused live monitoring and PTZ controls for cloud-connected devices, with WebRTC only mounted on this route."
    title="Live feed and PTZ"
  >
    <CloudLiveRoute />
  </CloudConsoleSurface>
);

export default LivePage;
