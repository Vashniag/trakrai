'use client';

import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';
import { DeviceRoiPage } from '@trakrai/roi-configurator/components/device-roi-page';
import { WebRtcProvider } from '@trakrai/webrtc/providers/webrtc-provider';

import { EdgeConsoleSurface } from '@/components/edge-console-surface';

const EdgeRoiRoute = () => {
  const { httpBaseUrl } = useLiveTransport();

  return (
    <WebRtcProvider httpBaseUrl={httpBaseUrl}>
      <DeviceRoiPage />
    </WebRtcProvider>
  );
};

const RoiPage = () => (
  <EdgeConsoleSurface
    description="Live ROI authoring against the device runtime, with PTZ base-location capture and direct config writes to the on-device ROI service."
    title="ROI configurator"
  >
    {() => <EdgeRoiRoute />}
  </EdgeConsoleSurface>
);

export default RoiPage;
