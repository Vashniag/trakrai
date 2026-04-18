'use client';

import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';
import { DeviceLivePage } from '@trakrai/live-ui/components/device-live-page';
import { WebRtcProvider } from '@trakrai/webrtc/providers/webrtc-provider';

import { cloudAppBuildConfig } from '@/lib/build-config';

const DeviceLiveRoutePage = () => {
  const { httpBaseUrl } = useLiveTransport();

  return (
    <WebRtcProvider
      httpBaseUrl={httpBaseUrl}
      iceTransportPolicy={cloudAppBuildConfig.iceTransportPolicy}
    >
      <DeviceLivePage />
    </WebRtcProvider>
  );
};

export default DeviceLiveRoutePage;
