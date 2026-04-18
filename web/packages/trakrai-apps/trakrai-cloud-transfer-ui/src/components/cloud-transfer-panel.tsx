'use client';

import { useState } from 'react';

import { CloudTransferQueueBrowser } from './cloud-transfer-queue-browser';
import { CloudTransferSelectedTransferCard } from './cloud-transfer-selected-transfer-card';
import { CloudTransferStatusCard } from './cloud-transfer-status-card';
import { DEFAULT_SERVICE_NAME } from './cloud-transfer-utils';
import { EnqueueDownloadCard } from './enqueue-download-card';
import { EnqueueUploadCard } from './enqueue-upload-card';

type CloudTransferPanelProps = Readonly<{
  serviceName?: string;
}>;

export const CloudTransferPanel = ({
  serviceName = DEFAULT_SERVICE_NAME,
}: CloudTransferPanelProps) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);

  const handleQueued = (transferId: string) => {
    setSelectedTransferId(transferId);
    setRefreshKey((current) => current + 1);
  };

  return (
    <section className="space-y-5">
      <CloudTransferStatusCard refreshKey={refreshKey} serviceName={serviceName} />

      <div className="grid gap-5 xl:grid-cols-2">
        <EnqueueUploadCard
          serviceName={serviceName}
          onQueued={(transfer) => {
            handleQueued(transfer.id);
          }}
        />
        <EnqueueDownloadCard
          serviceName={serviceName}
          onQueued={(transfer) => {
            handleQueued(transfer.id);
          }}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <CloudTransferQueueBrowser
          refreshKey={refreshKey}
          selectedTransferId={selectedTransferId}
          serviceName={serviceName}
          onSelectTransfer={setSelectedTransferId}
        />
        <CloudTransferSelectedTransferCard
          refreshKey={refreshKey}
          serviceName={serviceName}
          transferId={selectedTransferId}
        />
      </div>
    </section>
  );
};
