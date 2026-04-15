'use client';

import { CloudTransferPanel } from '@trakrai/cloud-transfer-ui/components/cloud-transfer-panel';
import { useCloudTransfer } from '@trakrai/cloud-transfer-ui/hooks/use-cloud-transfer';

export type DeviceTransfersPageProps = Readonly<{
  serviceName?: string;
}>;

export const DeviceTransfersPage = ({
  serviceName = 'cloud-transfer',
}: DeviceTransfersPageProps) => {
  const controller = useCloudTransfer(serviceName);

  return <CloudTransferPanel controller={controller} />;
};
