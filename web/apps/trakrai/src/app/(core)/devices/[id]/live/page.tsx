'use client';

import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';
import { WebRtcProvider } from '@trakrai/webrtc/providers/webrtc-provider';

import { DeviceLivePage } from '@/components/device-live-page';
import { cloudAppBuildConfig } from '@/lib/build-config';

const DeviceLiveRoutePage = () => {
  const { gatewayAccessToken, httpBaseUrl } = useLiveTransport();

  return (
    <WebRtcProvider
      gatewayAccessToken={gatewayAccessToken}
      httpBaseUrl={httpBaseUrl}
      iceTransportPolicy={cloudAppBuildConfig.iceTransportPolicy}
    >
      <DeviceLivePage />
    </WebRtcProvider>
  );
};

export default DeviceLiveRoutePage;
