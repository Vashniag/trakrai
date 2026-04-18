'use client';

import { CloudTransferPanel } from '@trakrai/cloud-transfer-ui/components/cloud-transfer-panel';

export type DeviceTransfersPageProps = Readonly<{
  serviceName?: string;
}>;

export const DeviceTransfersPage = ({
  serviceName = 'cloud-transfer',
}: DeviceTransfersPageProps) => <CloudTransferPanel serviceName={serviceName} />;
