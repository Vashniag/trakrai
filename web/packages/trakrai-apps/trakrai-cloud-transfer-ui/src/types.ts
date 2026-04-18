'use client';

import type {
  CloudTransfer_EnqueueDownload_Input,
  CloudTransfer_EnqueueUpload_Input,
  CloudTransfer_GetStats_Output,
  CloudTransfer_GetStatus_Output,
  CloudTransfer_GetTransfer_Output,
  CloudTransfer_ListTransfers_Output,
  CloudTransfer_QueueStats,
  CloudTransfer_Transfer,
} from '@trakrai/live-transport/generated-contracts/cloud_transfer';

export type EnqueueDownloadInput = CloudTransfer_EnqueueDownload_Input;
export type EnqueueUploadInput = CloudTransfer_EnqueueUpload_Input;
export type CloudTransferItem = CloudTransfer_Transfer;
export type CloudTransferQueueStats = CloudTransfer_QueueStats;
export type CloudTransferStatusPayload = CloudTransfer_GetStatus_Output;
export type CloudTransferStatsPayload = CloudTransfer_GetStats_Output;
export type CloudTransferTransferListPayload = CloudTransfer_ListTransfers_Output;
export type CloudTransferTransferPayload = CloudTransfer_GetTransfer_Output;
export type TransferDirection = CloudTransfer_Transfer['direction'];
export type TransferState = CloudTransfer_Transfer['state'];

export type CloudTransferFilter = Readonly<{
  direction?: TransferDirection | 'all';
  limit?: number;
  state?: TransferState | 'all';
}>;
