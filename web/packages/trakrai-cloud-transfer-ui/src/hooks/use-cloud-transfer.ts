'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDeviceService } from '@trakrai/live-transport/hooks/use-device-service';
import { isDeviceProtocolRequestError } from '@trakrai/live-transport/lib/device-protocol-types';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import type {
  CloudTransferFilter,
  CloudTransferItem,
  CloudTransferQueueStats,
  CloudTransferStatusPayload,
  CloudTransferTransferListPayload,
  CloudTransferTransferPayload,
  EnqueueDownloadInput,
  EnqueueUploadInput,
  TransferDirection,
  TransferState,
} from '../lib/cloud-transfer-types';

const RESPONSE_SUBTOPIC = 'response';
const DEFAULT_SERVICE_NAME = 'cloud-transfer';
const AUTO_REFRESH_MS = 5000;
const TRANSFER_RESPONSE_TYPES = ['cloud-transfer-transfer'] as const;

const normalizeFilter = (filter?: CloudTransferFilter) => {
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

export type CloudTransferControllerState = {
  activeTransfer: CloudTransferItem | null;
  enqueueDownload: (input: EnqueueDownloadInput) => Promise<void>;
  enqueueUpload: (input: EnqueueUploadInput) => Promise<void>;
  error: string | null;
  filter: CloudTransferFilter;
  isBusy: boolean;
  lastRefreshedAt: string | null;
  loadTransfer: (transferId: string) => Promise<void>;
  refresh: (filterOverride?: CloudTransferFilter) => Promise<void>;
  serviceRegistered: boolean;
  sharedDir: string | null;
  stats: CloudTransferQueueStats | null;
  statusLabel: string;
  transfers: CloudTransferItem[];
  updateFilter: (filter: CloudTransferFilter) => void;
};

const readRequestErrorMessage = (error: unknown): string => {
  const requestError = isDeviceProtocolRequestError(error) ? error : null;
  if (requestError !== null && requestError.payload !== null) {
    const payload = requestError.payload as { error?: string };
    if (typeof payload.error === 'string' && payload.error.trim() !== '') {
      return payload.error;
    }
  }

  return error instanceof Error ? error.message : 'Transfer request failed';
};

export const useCloudTransfer = (
  serviceName = DEFAULT_SERVICE_NAME,
): CloudTransferControllerState => {
  const normalizedServiceName = serviceName.trim();
  const transferService = useDeviceService(normalizedServiceName);
  const { appendLog, deviceStatus, transportState } = useLiveTransport();
  const [status, setStatus] = useState<CloudTransferStatusPayload | null>(null);
  const [transfers, setTransfers] = useState<CloudTransferItem[]>([]);
  const [activeTransfer, setActiveTransfer] = useState<CloudTransferItem | null>(null);
  const [filter, setFilter] = useState<CloudTransferFilter>({
    direction: 'all',
    limit: 20,
    state: 'all',
  });
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const requestTransferSnapshot = useCallback(
    async (nextFilter: CloudTransferFilter) => {
      const [statusResponse, listResponse] = await Promise.all([
        transferService.request<Record<string, never>, CloudTransferStatusPayload>(
          'get-status',
          {},
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: ['cloud-transfer-status'],
          },
        ),
        transferService.request<
          { direction?: TransferDirection; limit?: number; state?: TransferState },
          CloudTransferTransferListPayload
        >('list-transfers', normalizeFilter(nextFilter), {
          responseSubtopics: [RESPONSE_SUBTOPIC],
          responseTypes: ['cloud-transfer-list'],
        }),
      ]);

      return {
        nextStatus: statusResponse.payload,
        nextTransfers: listResponse.payload.items,
      };
    },
    [transferService],
  );

  const applyTransferSnapshot = useCallback(
    (snapshot: { nextStatus: CloudTransferStatusPayload; nextTransfers: CloudTransferItem[] }) => {
      setStatus(snapshot.nextStatus);
      setTransfers(snapshot.nextTransfers);
      setLastRefreshedAt(new Date().toISOString());
      setIsBusy(false);
    },
    [],
  );

  const refresh = useCallback(
    async (filterOverride?: CloudTransferFilter) => {
      if (normalizedServiceName === '') {
        return;
      }

      const nextFilter = filterOverride ?? filter;
      setError(null);
      setIsBusy(true);

      try {
        const snapshot = await requestTransferSnapshot(nextFilter);
        applyTransferSnapshot(snapshot);
      } catch (nextError) {
        setError(readRequestErrorMessage(nextError));
        setIsBusy(false);
      }
    },
    [applyTransferSnapshot, filter, normalizedServiceName, requestTransferSnapshot],
  );

  const loadTransfer = useCallback(
    async (transferId: string) => {
      const normalizedTransferId = transferId.trim();
      if (normalizedTransferId === '' || normalizedServiceName === '') {
        return;
      }

      setError(null);
      setIsBusy(true);

      try {
        const response = await transferService.request<
          { transferId: string },
          CloudTransferTransferPayload
        >(
          'get-transfer',
          { transferId: normalizedTransferId },
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: TRANSFER_RESPONSE_TYPES,
          },
        );
        setActiveTransfer(response.payload.transfer);
        setIsBusy(false);
      } catch (nextError) {
        setError(readRequestErrorMessage(nextError));
        setIsBusy(false);
      }
    },
    [normalizedServiceName, transferService],
  );

  const enqueueUpload = useCallback(
    async (input: EnqueueUploadInput) => {
      if (normalizedServiceName === '') {
        return;
      }

      setError(null);
      setIsBusy(true);

      try {
        const response = await transferService.request<
          EnqueueUploadInput,
          CloudTransferTransferPayload
        >('enqueue-upload', input, {
          responseSubtopics: [RESPONSE_SUBTOPIC],
          responseTypes: TRANSFER_RESPONSE_TYPES,
        });
        setActiveTransfer(response.payload.transfer);
        appendLog('info', `Queued upload ${response.payload.transfer.id}`);
        await refresh();
      } catch (nextError) {
        setError(readRequestErrorMessage(nextError));
        setIsBusy(false);
      }
    },
    [appendLog, normalizedServiceName, refresh, transferService],
  );

  const enqueueDownload = useCallback(
    async (input: EnqueueDownloadInput) => {
      if (normalizedServiceName === '') {
        return;
      }

      setError(null);
      setIsBusy(true);

      try {
        const response = await transferService.request<
          EnqueueDownloadInput,
          CloudTransferTransferPayload
        >('enqueue-download', input, {
          responseSubtopics: [RESPONSE_SUBTOPIC],
          responseTypes: TRANSFER_RESPONSE_TYPES,
        });
        setActiveTransfer(response.payload.transfer);
        appendLog('info', `Queued download ${response.payload.transfer.id}`);
        await refresh();
      } catch (nextError) {
        setError(readRequestErrorMessage(nextError));
        setIsBusy(false);
      }
    },
    [appendLog, normalizedServiceName, refresh, transferService],
  );

  useEffect(() => {
    if (normalizedServiceName === '' || transportState !== 'connected') {
      return;
    }

    void requestTransferSnapshot(filter)
      .then((snapshot) => {
        applyTransferSnapshot(snapshot);
        return undefined;
      })
      .catch((nextError) => {
        setError(readRequestErrorMessage(nextError));
      });
  }, [
    applyTransferSnapshot,
    filter,
    normalizedServiceName,
    requestTransferSnapshot,
    transportState,
  ]);

  useEffect(() => {
    if (normalizedServiceName === '' || transportState !== 'connected') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [normalizedServiceName, refresh, transportState]);

  const serviceStatus = deviceStatus?.services?.[normalizedServiceName];

  return useMemo(
    () => ({
      activeTransfer,
      enqueueDownload,
      enqueueUpload,
      error,
      filter,
      isBusy,
      lastRefreshedAt,
      loadTransfer,
      refresh,
      serviceRegistered: serviceStatus !== undefined,
      sharedDir: status?.sharedDir ?? null,
      stats: status?.stats ?? null,
      statusLabel: serviceStatus?.status ?? 'offline',
      transfers,
      updateFilter: setFilter,
    }),
    [
      activeTransfer,
      enqueueDownload,
      enqueueUpload,
      error,
      filter,
      isBusy,
      lastRefreshedAt,
      loadTransfer,
      refresh,
      serviceStatus,
      status,
      transfers,
    ],
  );
};
