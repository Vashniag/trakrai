'use client';

import { DeviceTransfersPage } from '@trakrai/live-ui/components/device-transfers-page';

import { EdgeConsoleSurface } from '@/components/edge-console-surface';

const TransfersPage = () => (
  <EdgeConsoleSurface
    description="Upload and download queue management through the on-device cloud transfer service."
    title="Transfers"
  >
    {() => <DeviceTransfersPage />}
  </EdgeConsoleSurface>
);

export default TransfersPage;
