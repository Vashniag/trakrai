'use client';

import { CloudTransferPanel } from '@trakrai/cloud-transfer-ui/components/cloud-transfer-panel';

import { EdgeConsoleSurface } from '@/components/edge-console-surface';

const TransfersPage = () => (
  <EdgeConsoleSurface
    description="Upload and download queue management through the on-device cloud transfer service."
    title="Transfers"
  >
    {() => <CloudTransferPanel serviceName="cloud-transfer" />}
  </EdgeConsoleSurface>
);

export default TransfersPage;
