'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDeviceRuntime } from '@trakrai/live-transport/hooks/use-device-runtime';
import { useDeviceService } from '@trakrai/live-transport/hooks/use-device-service';
import { useLiveTransport } from '@trakrai/live-transport/hooks/use-live-transport';
import { isDeviceProtocolRequestError } from '@trakrai/live-transport/lib/device-protocol-types';
import { normalizeOptionalString } from '@trakrai/live-transport/lib/live-transport-utils';

import type { PtzCapabilities, PtzPosition, PtzVelocityCommand } from '../lib/ptz-types';

import { PTZ_SERVICE_NAME, readPtzState } from '../lib/ptz-transport';

export type PtzControllerState = {
  activeDirection: string | null;
  cameraName: string;
  capabilities: PtzCapabilities | null;
  controlsEnabled: boolean;
  error: string | null;
  isCameraConfigured: boolean;
  lastCommand: string;
  lastMovement: string;
  position: PtzPosition | null;
  serviceRegistered: boolean;
  statusLabel: string;
  beginMove: (directionId: string, velocity: PtzVelocityCommand) => void;
  endMove: () => void;
  goHome: () => void;
  refreshPosition: () => void;
  setZoom: (zoom: number) => void;
};

const PTZ_RESPONSE_SUBTOPIC = 'response';
const PTZ_GET_POSITION_COMMAND = 'get-position';
const PTZ_GET_STATUS_COMMAND = 'get-status';

type PtzStatusPayload = Readonly<{
  activeCamera?: string | null;
  capabilities?: PtzCapabilities | null;
  configuredCameras: string[];
  lastCommand?: string | null;
  lastError?: string | null;
  position?: PtzPosition | null;
}>;

type PtzCommandAckPayload = Readonly<{
  capabilities?: PtzCapabilities | null;
  cameraName?: string;
  command?: string;
  position?: PtzPosition | null;
}>;

type PtzErrorPayload = Readonly<{
  cameraName?: string;
  command?: string;
  error?: string;
  requestType?: string;
}>;

export const usePtzController = (selectedCameraName: string): PtzControllerState => {
  const { transportState } = useLiveTransport();
  const ptzService = useDeviceService(PTZ_SERVICE_NAME);
  const { appendLog, deviceStatus } = useDeviceRuntime();
  const [ptzState, setPtzState] = useState<ReturnType<typeof readPtzState>>(null);
  const [ptzError, setPtzError] = useState<string | null>(null);
  const [activeDirection, setActiveDirection] = useState<string | null>(null);
  const lastAutoRefreshKeyRef = useRef<string | null>(null);
  const lastStatusRequestKeyRef = useRef<string | null>(null);
  const reportedPtzState = useMemo(
    () => readPtzState(deviceStatus?.services?.['ptz-control']),
    [deviceStatus],
  );

  let cameraName = selectedCameraName.trim();
  if (cameraName === '') {
    cameraName = ptzState?.activeCamera ?? reportedPtzState?.activeCamera ?? '';
  }
  const ptzServiceStatus = deviceStatus?.services?.['ptz-control'];
  const ptzConfiguredCameras =
    ptzState?.configuredCameras ?? reportedPtzState?.configuredCameras ?? [];
  const isCameraConfigured =
    cameraName !== '' &&
    (ptzConfiguredCameras.length === 0 || ptzConfiguredCameras.includes(cameraName));
  const controlsEnabled = ptzServiceStatus !== undefined && cameraName !== '' && isCameraConfigured;
  const currentPosition = ptzState?.position ?? null;
  const reportedPosition = reportedPtzState?.position ?? null;
  let position: PtzPosition | null = null;
  if (currentPosition?.cameraName === cameraName) {
    position = currentPosition;
  } else if (reportedPosition?.cameraName === cameraName) {
    position = reportedPosition;
  }
  const capabilities = (position?.capabilities ??
    ptzState?.capabilities ??
    reportedPtzState?.capabilities ??
    null) as PtzCapabilities | null;
  const statusLabel =
    ptzState?.status ?? reportedPtzState?.status ?? ptzServiceStatus?.status ?? 'offline';
  const lastCommand = ptzState?.lastCommand ?? reportedPtzState?.lastCommand ?? 'none';
  const lastMovement =
    position?.moveStatus?.panTilt ??
    position?.moveStatus?.zoom ??
    ptzState?.status ??
    reportedPtzState?.status ??
    'idle';
  const resolvedPtzError = ptzError ?? reportedPtzState?.lastError ?? null;

  const applyStatusPayload = useCallback(
    (payload: PtzStatusPayload) => {
      setPtzState((currentState) => ({
        activeCamera: payload.activeCamera ?? currentState?.activeCamera ?? null,
        capabilities: payload.capabilities ?? currentState?.capabilities ?? null,
        configuredCameras:
          payload.configuredCameras.length > 0
            ? payload.configuredCameras
            : (currentState?.configuredCameras ?? []),
        lastCommand: payload.lastCommand ?? currentState?.lastCommand ?? null,
        lastError: payload.lastError ?? null,
        position: payload.position ?? currentState?.position ?? null,
        status: currentState?.status ?? 'idle',
      }));
      setPtzError(payload.lastError ?? null);
      appendLog('info', 'PTZ status snapshot refreshed');
    },
    [appendLog],
  );

  const applyPositionPayload = useCallback(
    (payload: PtzPosition) => {
      setPtzState((currentState) => ({
        activeCamera: payload.cameraName,
        capabilities: payload.capabilities ?? currentState?.capabilities ?? null,
        configuredCameras: currentState?.configuredCameras ?? [],
        lastCommand: PTZ_GET_POSITION_COMMAND,
        lastError: null,
        position: payload,
        status: currentState?.status ?? 'idle',
      }));
      setPtzError(null);
      appendLog('info', `PTZ position refreshed for ${payload.cameraName}`);
    },
    [appendLog],
  );

  const applyCommandAckPayload = useCallback(
    (payload: PtzCommandAckPayload) => {
      setPtzState((currentState) => ({
        activeCamera:
          normalizeOptionalString(payload.cameraName) ?? currentState?.activeCamera ?? null,
        capabilities:
          payload.capabilities ??
          payload.position?.capabilities ??
          currentState?.capabilities ??
          null,
        configuredCameras: currentState?.configuredCameras ?? [],
        lastCommand: normalizeOptionalString(payload.command) ?? currentState?.lastCommand ?? null,
        lastError: null,
        position: payload.position ?? currentState?.position ?? null,
        status: payload.command === 'start-move' ? 'moving' : 'idle',
      }));
      setPtzError(null);
      appendLog(
        'info',
        `PTZ command acknowledged: ${payload.command ?? 'unknown'}${
          typeof payload.cameraName === 'string' && payload.cameraName.trim() !== ''
            ? ` (${payload.cameraName})`
            : ''
        }`,
      );
    },
    [appendLog],
  );

  const handlePtzError = useCallback(
    (nextError: unknown) => {
      const payload =
        isDeviceProtocolRequestError(nextError) && nextError.payload !== null
          ? (nextError.payload as PtzErrorPayload)
          : null;
      const errorMessage =
        payload?.error ??
        (nextError instanceof Error ? nextError.message : 'PTZ request failed');
      setPtzError(errorMessage);
      setPtzState((currentState) => ({
        activeCamera:
          normalizeOptionalString(payload?.cameraName) ?? currentState?.activeCamera ?? null,
        capabilities: currentState?.capabilities ?? null,
        configuredCameras: currentState?.configuredCameras ?? [],
        lastCommand:
          normalizeOptionalString(payload?.command ?? payload?.requestType) ??
          currentState?.lastCommand ??
          null,
        lastError: errorMessage,
        position: currentState?.position ?? null,
        status: 'error',
      }));
      appendLog('error', errorMessage);
    },
    [appendLog],
  );

  const refreshPosition = useCallback(() => {
    if (cameraName === '') {
      return;
    }

    appendLog('info', `Requesting PTZ position for ${cameraName}`);
    setPtzError(null);
    void ptzService
      .request<{ cameraName: string }, PtzPosition>(
        PTZ_GET_POSITION_COMMAND,
        { cameraName },
        {
          responseSubtopics: [PTZ_RESPONSE_SUBTOPIC],
          responseTypes: ['ptz-position'],
        },
      )
      .then((response) => {
        applyPositionPayload(response.payload);
      })
      .catch(handlePtzError);
  }, [appendLog, applyPositionPayload, cameraName, handlePtzError, ptzService]);

  useEffect(() => {
    if (transportState !== 'connected') {
      lastStatusRequestKeyRef.current = null;
      if (cameraName === '') {
        lastAutoRefreshKeyRef.current = null;
      }
      return;
    }

    const nextStatusKey = `${cameraName !== '' ? cameraName : 'default'}::${transportState}`;
    if (lastStatusRequestKeyRef.current !== nextStatusKey) {
      lastStatusRequestKeyRef.current = nextStatusKey;
      void ptzService
        .request<{ cameraName?: string }, PtzStatusPayload>(
          PTZ_GET_STATUS_COMMAND,
          cameraName !== '' ? { cameraName } : {},
          {
            responseSubtopics: [PTZ_RESPONSE_SUBTOPIC],
            responseTypes: ['ptz-status'],
          },
        )
        .then((response) => {
          applyStatusPayload(response.payload);
        })
        .catch(handlePtzError);
    }

    if (cameraName === '') {
      lastAutoRefreshKeyRef.current = null;
      return;
    }

    const nextAutoRefreshKey = `${cameraName}::${transportState}`;
    if (lastAutoRefreshKeyRef.current === nextAutoRefreshKey) {
      return;
    }

    lastAutoRefreshKeyRef.current = nextAutoRefreshKey;
    void ptzService
      .request<{ cameraName: string }, PtzPosition>(
        PTZ_GET_POSITION_COMMAND,
        { cameraName },
        {
          responseSubtopics: [PTZ_RESPONSE_SUBTOPIC],
          responseTypes: ['ptz-position'],
        },
      )
      .then((response) => {
        applyPositionPayload(response.payload);
      })
      .catch(handlePtzError);
  }, [applyPositionPayload, applyStatusPayload, cameraName, handlePtzError, ptzService, transportState]);

  useEffect(() => {
    return () => {
      if (activeDirection !== null && cameraName !== '') {
        ptzService.notify('stop-move', { cameraName });
      }
    };
  }, [activeDirection, cameraName, ptzService]);

  const beginMove = useCallback(
    (directionId: string, velocity: PtzVelocityCommand) => {
      if (!controlsEnabled) {
        return;
      }

      setPtzError(null);
      void ptzService
        .request<
          { cameraName: string; velocity: PtzVelocityCommand },
          PtzCommandAckPayload
        >(
          'start-move',
          {
            cameraName,
            velocity,
          },
          {
            responseSubtopics: [PTZ_RESPONSE_SUBTOPIC],
            responseTypes: ['ptz-command-ack'],
          },
        )
        .then((response) => {
          applyCommandAckPayload(response.payload);
          setActiveDirection(directionId);
        })
        .catch((error) => {
          setActiveDirection(null);
          handlePtzError(error);
        });
    },
    [applyCommandAckPayload, cameraName, controlsEnabled, handlePtzError, ptzService],
  );

  const endMove = useCallback(() => {
    if (cameraName === '') {
      return;
    }

    void ptzService
      .request<{ cameraName: string }, PtzCommandAckPayload>(
        'stop-move',
        { cameraName },
        {
          responseSubtopics: [PTZ_RESPONSE_SUBTOPIC],
          responseTypes: ['ptz-command-ack'],
        },
      )
      .then((response) => {
        applyCommandAckPayload(response.payload);
        setActiveDirection(null);
      })
      .catch((error) => {
        setActiveDirection(null);
        handlePtzError(error);
      });
  }, [applyCommandAckPayload, cameraName, handlePtzError, ptzService]);

  const setZoom = useCallback(
    (zoom: number) => {
      if (cameraName === '') {
        return;
      }

      appendLog('info', `Setting PTZ zoom for ${cameraName} to ${zoom.toFixed(2)}`);
      setPtzError(null);
      void ptzService
        .request<{ cameraName: string; zoom: number }, PtzCommandAckPayload>(
          'set-zoom',
          {
            cameraName,
            zoom,
          },
          {
            responseSubtopics: [PTZ_RESPONSE_SUBTOPIC],
            responseTypes: ['ptz-command-ack'],
          },
        )
        .then((response) => {
          applyCommandAckPayload(response.payload);
        })
        .catch(handlePtzError);
    },
    [appendLog, applyCommandAckPayload, cameraName, handlePtzError, ptzService],
  );

  const goHome = useCallback(() => {
    if (cameraName === '') {
      return;
    }

    appendLog('info', `Sending PTZ home command for ${cameraName}`);
    setPtzError(null);
    void ptzService
      .request<{ cameraName: string }, PtzCommandAckPayload>(
        'go-home',
        { cameraName },
        {
          responseSubtopics: [PTZ_RESPONSE_SUBTOPIC],
          responseTypes: ['ptz-command-ack'],
        },
      )
      .then((response) => {
        applyCommandAckPayload(response.payload);
      })
      .catch(handlePtzError);
  }, [appendLog, applyCommandAckPayload, cameraName, handlePtzError, ptzService]);

  return useMemo(
    () => ({
      activeDirection,
      beginMove,
      cameraName,
      capabilities,
      controlsEnabled,
      endMove,
      error: resolvedPtzError,
      goHome,
      isCameraConfigured,
      lastCommand,
      lastMovement,
      position,
      refreshPosition,
      serviceRegistered: ptzServiceStatus !== undefined,
      setZoom,
      statusLabel,
    }),
    [
      activeDirection,
      beginMove,
      cameraName,
      capabilities,
      controlsEnabled,
      endMove,
      goHome,
      isCameraConfigured,
      lastCommand,
      lastMovement,
      position,
      ptzServiceStatus,
      refreshPosition,
      resolvedPtzError,
      setZoom,
      statusLabel,
    ],
  );
};
