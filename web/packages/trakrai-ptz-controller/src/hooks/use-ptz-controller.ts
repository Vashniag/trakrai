'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDeviceRuntime } from '@trakrai/live-transport/hooks/use-device-runtime';
import { useLiveTransport } from '@trakrai/live-transport/hooks/use-live-transport';
import {
  getEnvelopeType,
  normalizeOptionalString,
} from '@trakrai/live-transport/lib/live-transport-utils';

import type { PtzCapabilities, PtzPosition, PtzVelocityCommand } from '../lib/ptz-types';

import {
  createPtzCommandPacket,
  isPtzPacket,
  readPtzResponsePayload,
  readPtzState,
} from '../lib/ptz-transport';

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

export const usePtzController = (selectedCameraName: string): PtzControllerState => {
  const { sendPacket, subscribeToPackets, transportState } = useLiveTransport();
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

  useEffect(() => {
    const unsubscribePackets = subscribeToPackets((packet) => {
      if (!isPtzPacket(packet) || packet.subtopic !== PTZ_RESPONSE_SUBTOPIC) {
        return;
      }

      const responseType = getEnvelopeType(packet.envelope);
      if (responseType === null) {
        return;
      }

      if (responseType === 'ptz-status') {
        const payload =
          readPtzResponsePayload<Omit<NonNullable<typeof ptzState>, 'status'>>(packet);
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
        return;
      }

      if (responseType === 'ptz-position') {
        const payload = readPtzResponsePayload<PtzPosition>(packet);
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
        return;
      }

      if (responseType === 'ptz-command-ack') {
        const payload = readPtzResponsePayload<{
          capabilities?: PtzCapabilities | null;
          cameraName: string;
          command: string;
          position?: PtzPosition;
        }>(packet);
        setPtzState((currentState) => ({
          activeCamera:
            normalizeOptionalString(payload.cameraName) ?? currentState?.activeCamera ?? null,
          capabilities:
            payload.capabilities ??
            payload.position?.capabilities ??
            currentState?.capabilities ??
            null,
          configuredCameras: currentState?.configuredCameras ?? [],
          lastCommand:
            normalizeOptionalString(payload.command) ?? currentState?.lastCommand ?? null,
          lastError: null,
          position: payload.position ?? currentState?.position ?? null,
          status: payload.command === 'start-move' ? 'moving' : 'idle',
        }));
        setPtzError(null);
        appendLog(
          'info',
          `PTZ command acknowledged: ${payload.command}${
            typeof payload.cameraName === 'string' && payload.cameraName.trim() !== ''
              ? ` (${payload.cameraName})`
              : ''
          }`,
        );
        return;
      }

      if (responseType === 'ptz-error' || responseType === 'service-unavailable') {
        const payload = readPtzResponsePayload<{
          cameraName?: string;
          command?: string;
          error?: string;
          requestType?: string;
        }>(packet);
        const nextError =
          payload.error ?? `PTZ ${payload.command ?? payload.requestType ?? 'request'} failed`;
        setPtzError(nextError);
        setPtzState((currentState) => ({
          activeCamera:
            normalizeOptionalString(payload.cameraName) ?? currentState?.activeCamera ?? null,
          capabilities: currentState?.capabilities ?? null,
          configuredCameras: currentState?.configuredCameras ?? [],
          lastCommand:
            normalizeOptionalString(payload.command ?? payload.requestType) ??
            currentState?.lastCommand ??
            null,
          lastError: nextError,
          position: currentState?.position ?? null,
          status: 'error',
        }));
        appendLog('error', nextError);
      }
    });

    return () => {
      unsubscribePackets();
    };
  }, [appendLog, subscribeToPackets]);

  const refreshPosition = useCallback(() => {
    if (cameraName === '') {
      return;
    }

    appendLog('info', `Requesting PTZ position for ${cameraName}`);
    setPtzError(null);
    sendPacket(createPtzCommandPacket(PTZ_GET_POSITION_COMMAND, { cameraName }));
  }, [appendLog, cameraName, sendPacket]);

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
      sendPacket(
        createPtzCommandPacket(PTZ_GET_STATUS_COMMAND, cameraName !== '' ? { cameraName } : {}),
      );
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
    sendPacket(createPtzCommandPacket(PTZ_GET_POSITION_COMMAND, { cameraName }));
  }, [cameraName, sendPacket, transportState]);

  useEffect(() => {
    return () => {
      if (activeDirection !== null && cameraName !== '') {
        sendPacket(createPtzCommandPacket('stop-move', { cameraName }));
      }
    };
  }, [activeDirection, cameraName, sendPacket]);

  const beginMove = useCallback(
    (directionId: string, velocity: PtzVelocityCommand) => {
      if (!controlsEnabled) {
        return;
      }

      setPtzError(null);
      sendPacket(
        createPtzCommandPacket('start-move', {
          cameraName,
          velocity,
        }),
      );
      setActiveDirection(directionId);
    },
    [cameraName, controlsEnabled, sendPacket],
  );

  const endMove = useCallback(() => {
    if (cameraName === '') {
      return;
    }

    sendPacket(createPtzCommandPacket('stop-move', { cameraName }));
    setActiveDirection(null);
  }, [cameraName, sendPacket]);

  const setZoom = useCallback(
    (zoom: number) => {
      if (cameraName === '') {
        return;
      }

      appendLog('info', `Setting PTZ zoom for ${cameraName} to ${zoom.toFixed(2)}`);
      setPtzError(null);
      sendPacket(
        createPtzCommandPacket('set-zoom', {
          cameraName,
          zoom,
        }),
      );
    },
    [appendLog, cameraName, sendPacket],
  );

  const goHome = useCallback(() => {
    if (cameraName === '') {
      return;
    }

    appendLog('info', `Sending PTZ home command for ${cameraName}`);
    setPtzError(null);
    sendPacket(createPtzCommandPacket('go-home', { cameraName }));
  }, [appendLog, cameraName, sendPacket]);

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
