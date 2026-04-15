'use client';

import { DeviceTransfersPage } from '@trakrai/live-ui/components/device-transfers-page';

import { CloudConsoleSurface } from '@/components/cloud-console-surface';

const TransferPage = () => (
  <CloudConsoleSurface
    description="Upload and download queue management through the device-side cloud transfer service."
    title="Transfers"
  >
    <DeviceTransfersPage />
  </CloudConsoleSurface>
);

export default TransferPage;
