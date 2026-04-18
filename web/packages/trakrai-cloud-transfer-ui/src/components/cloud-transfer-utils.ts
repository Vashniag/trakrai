'use client';

import { isDeviceProtocolRequestError } from '@trakrai/live-transport/lib/device-protocol-types';

import type {
  CloudTransferFilter,
  CloudTransferItem,
  EnqueueDownloadInput,
  EnqueueUploadInput,
  TransferDirection,
  TransferState,
} from '../types';

export const RESPONSE_SUBTOPIC = 'response';
export const DEFAULT_SERVICE_NAME = 'cloud-transfer';
export const AUTO_REFRESH_MS = 5000;
export const TRANSFER_RESPONSE_TYPES = ['cloud-transfer-transfer'] as const;
export const FILTER_DIRECTIONS: ReadonlyArray<TransferDirection | 'all'> = [
  'all',
  'upload',
  'download',
];
export const FILTER_STATES: ReadonlyArray<TransferState | 'all'> = [
  'all',
  'queued',
  'running',
  'retry_wait',
  'completed',
  'failed',
];

export const normalizeFilter = (filter?: CloudTransferFilter) => {
  const payload: {
    direction?: TransferDirection;
    limit?: number;
    state?: TransferState;
  } = {};

  if (filter?.direction !== undefined && filter.direction !== 'all') {
    payload.direction = filter.direction;
  }
  if (typeof filter?.limit === 'number' && filter.limit > 0) {
    payload.limit = filter.limit;
  }
  if (filter?.state !== undefined && filter.state !== 'all') {
    payload.state = filter.state;
  }

  return payload;
};

export const readRequestErrorMessage = (error: unknown): string => {
  const requestError = isDeviceProtocolRequestError(error) ? error : null;
  if (requestError !== null && requestError.payload !== null) {
    const payload = requestError.payload as { error?: string };
    if (typeof payload.error === 'string' && payload.error.trim() !== '') {
      return payload.error;
    }
  }

  return error instanceof Error ? error.message : 'Transfer request failed';
};

export const formatTimestamp = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value.trim() === '') {
    return 'N/A';
  }

  return new Date(value).toLocaleString();
};

export const formatTransferLabel = (transfer: CloudTransferItem): string =>
  `${transfer.direction} · ${transfer.state} · attempts ${transfer.attempts}`;

export const parseMetadata = (value: string): Record<string, string> | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Metadata must be a JSON object.');
  }

  const metadata = Object.entries(parsed).reduce<Record<string, string>>((result, [key, entry]) => {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
    return result;
  }, {});

  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

export const normalizeOptionalInput = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const createEmptyUploadDraft = () => ({
  contentType: '',
  localPath: '',
  metadata: '',
  remotePath: '',
  timeout: '',
});

export const createEmptyDownloadDraft = () => ({
  localPath: '',
  metadata: '',
  remotePath: '',
  timeout: '',
});

export const toUploadInput = (
  draft: ReturnType<typeof createEmptyUploadDraft>,
): EnqueueUploadInput => ({
  contentType: normalizeOptionalInput(draft.contentType),
  localPath: draft.localPath.trim(),
  metadata: parseMetadata(draft.metadata),
  remotePath: draft.remotePath.trim(),
  timeout: normalizeOptionalInput(draft.timeout),
});

export const toDownloadInput = (
  draft: ReturnType<typeof createEmptyDownloadDraft>,
): EnqueueDownloadInput => ({
  localPath: draft.localPath.trim(),
  metadata: parseMetadata(draft.metadata),
  remotePath: draft.remotePath.trim(),
  timeout: normalizeOptionalInput(draft.timeout),
});
