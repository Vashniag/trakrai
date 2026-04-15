'use client';

export type TransferDirection = 'download' | 'upload';
export type TransferState = 'completed' | 'failed' | 'queued' | 'retry_wait' | 'running';

export type CloudTransferQueueStats = {
  completed: number;
  downloadQueued: number;
  downloadsCompleted: number;
  downloadsFailed: number;
  failed: number;
  nextAttemptAt?: string | null;
  pending: number;
  running: number;
  total: number;
  uploadQueued: number;
  uploadsCompleted: number;
  uploadsFailed: number;
};

export type CloudTransferItem = {
  attempts: number;
  completedAt?: string | null;
  contentType?: string;
  createdAt: string;
  deadlineAt?: string | null;
  deviceId: string;
  direction: TransferDirection;
  id: string;
  lastError?: string;
  localPath: string;
  metadata?: Record<string, string>;
  nextAttemptAt?: string | null;
  objectKey?: string;
  remotePath: string;
  startedAt?: string | null;
  state: TransferState;
  updatedAt: string;
};

export type CloudTransferStatusPayload = {
  databasePath: string;
  deviceId: string;
  requestId?: string;
  sharedDir: string;
  stats: CloudTransferQueueStats;
};

export type CloudTransferTransferPayload = {
  requestId?: string;
  transfer: CloudTransferItem;
};

export type CloudTransferTransferListPayload = {
  items: CloudTransferItem[];
  requestId?: string;
};

export type CloudTransferStatsPayload = {
  requestId?: string;
  stats: CloudTransferQueueStats;
};

export type CloudTransferFilter = Readonly<{
  direction?: TransferDirection | 'all';
  limit?: number;
  state?: TransferState | 'all';
}>;

export type EnqueueUploadInput = Readonly<{
  contentType?: string;
  localPath: string;
  metadata?: Record<string, string>;
  remotePath: string;
  timeout?: string;
}>;

export type EnqueueDownloadInput = Readonly<{
  localPath: string;
  metadata?: Record<string, string>;
  remotePath: string;
  timeout?: string;
}>;
