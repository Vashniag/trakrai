'use client';

import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';
import { DeviceLivePage } from '@trakrai/live-ui/components/device-live-page';
import { WebRtcProvider } from '@trakrai/webrtc/providers/webrtc-provider';

import { EdgeConsoleSurface } from '@/components/edge-console-surface';

const EdgeLiveRoute = () => {
  const { httpBaseUrl } = useLiveTransport();

  return (
    <WebRtcProvider httpBaseUrl={httpBaseUrl}>
      <DeviceLivePage />
    </WebRtcProvider>
  );
};

const HomePage = () => (
  <EdgeConsoleSurface
    description="Focused live monitoring and PTZ controls for the edge runtime, with WebRTC only mounted on this route."
    title="Live feed and PTZ"
  >
    {() => <EdgeLiveRoute />}
  </EdgeConsoleSurface>
);

export default HomePage;
