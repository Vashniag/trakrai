'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDeviceService } from '@trakrai/live-transport/hooks/use-device-service';
import { isDeviceProtocolRequestError } from '@trakrai/live-transport/lib/device-protocol-types';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import type {
  RoiConfigControllerState,
  RoiDocument,
  RoiDocumentPayload,
  RoiStatusSummary,
} from '../lib/roi-config-types';

const ROI_SERVICE_NAME = 'roi-config';
const RESPONSE_SUBTOPIC = 'response';

const readRequestErrorMessage = (error: unknown): string => {
  const requestError = isDeviceProtocolRequestError(error) ? error : null;
  if (requestError !== null && requestError.payload !== null) {
    const payload = requestError.payload as { error?: string };
    if (typeof payload.error === 'string' && payload.error.trim() !== '') {
      return payload.error;
    }
  }
  return error instanceof Error ? error.message : 'ROI request failed';
};

const readSummary = (payload: RoiDocumentPayload): RoiStatusSummary => ({
  baseLocationCount: payload.baseLocationCount,
  cameraCount: payload.cameraCount,
  documentHash: payload.documentHash,
  filePath: payload.filePath,
  roiBoxCount: payload.roiBoxCount,
  updatedAt: payload.updatedAt,
});

export const useRoiConfig = (): RoiConfigControllerState => {
  const roiService = useDeviceService(ROI_SERVICE_NAME);
  const { deviceStatus, transportState } = useLiveTransport();
  const [document, setDocument] = useState<RoiDocument | null>(null);
  const [summary, setSummary] = useState<RoiStatusSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const serviceStatus = deviceStatus?.services?.[ROI_SERVICE_NAME];

  const applyPayload = useCallback((payload: RoiDocumentPayload) => {
    setDocument(payload.document);
    setSummary(readSummary(payload));
    setLastRefreshedAt(new Date().toISOString());
    setError(null);
    setIsBusy(false);
    return payload.document;
  }, []);

  const refresh = useCallback(async () => {
    setIsBusy(true);
    try {
      const response = await roiService.request<Record<string, never>, RoiDocumentPayload>(
        'get-config',
        {},
        {
          responseSubtopics: [RESPONSE_SUBTOPIC],
          responseTypes: ['roi-config-document'],
        },
      );
      return applyPayload(response.payload);
    } catch (nextError) {
      setError(readRequestErrorMessage(nextError));
      setIsBusy(false);
      return null;
    }
  }, [applyPayload, roiService]);

  const saveDocument = useCallback(
    async (nextDocument: RoiDocument) => {
      setIsBusy(true);
      try {
        const response = await roiService.request<{ document: RoiDocument }, RoiDocumentPayload>(
          'save-config',
          { document: nextDocument },
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: ['roi-config-document'],
          },
        );
        return applyPayload(response.payload);
      } catch (nextError) {
        setError(readRequestErrorMessage(nextError));
        setIsBusy(false);
        return null;
      }
    },
    [applyPayload, roiService],
  );

  useEffect(() => {
    if (transportState !== 'connected') {
      return;
    }
    const refreshHandle = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => {
      window.clearTimeout(refreshHandle);
    };
  }, [refresh, transportState]);

  return useMemo(
    () => ({
      document,
      error,
      filePath: summary?.filePath ?? null,
      isBusy,
      lastRefreshedAt,
      refresh,
      saveDocument,
      serviceRegistered: serviceStatus !== undefined,
      statusLabel: serviceStatus?.status ?? 'offline',
      summary,
    }),
    [document, error, isBusy, lastRefreshedAt, refresh, saveDocument, serviceStatus, summary],
  );
};
