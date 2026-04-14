'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDeviceRuntime } from '@trakrai/live-transport/hooks/use-device-runtime';
import { useLiveTransport } from '@trakrai/live-transport/hooks/use-live-transport';

import type {
  PtzCapabilities,
  PtzPosition,
  PtzVelocityCommand,
} from '@trakrai/live-transport/lib/live-types';

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

export const usePtzController = (selectedCameraName: string): PtzControllerState => {
  const { sendMessage, transportState } = useLiveTransport();
  const { appendLog, clearPtzError, deviceStatus, ptzError, ptzState } = useDeviceRuntime();
  const [activeDirection, setActiveDirection] = useState<string | null>(null);
  const lastAutoRefreshKeyRef = useRef<string | null>(null);

  const cameraName =
    selectedCameraName.trim() !== '' ? selectedCameraName : (ptzState?.activeCamera ?? '');
  const ptzServiceStatus = deviceStatus?.services?.['ptz-control'];
  const ptzConfiguredCameras = ptzState?.configuredCameras ?? [];
  const isCameraConfigured =
    cameraName !== '' &&
    (ptzConfiguredCameras.length === 0 || ptzConfiguredCameras.includes(cameraName));
  const controlsEnabled = ptzServiceStatus !== undefined && cameraName !== '' && isCameraConfigured;
  const position = ptzState?.position?.cameraName === cameraName ? ptzState.position : null;
  const capabilities = (position?.capabilities ??
    ptzState?.capabilities ??
    null) as PtzCapabilities | null;
  const statusLabel = ptzState?.status ?? ptzServiceStatus?.status ?? 'offline';
  const lastCommand = ptzState?.lastCommand ?? 'none';
  const lastMovement =
    position?.moveStatus?.panTilt ?? position?.moveStatus?.zoom ?? ptzState?.status ?? 'idle';

  const refreshPosition = useCallback(() => {
    if (cameraName === '') {
      return;
    }

    appendLog('info', `Requesting PTZ position for ${cameraName}`);
    clearPtzError();
    sendMessage('ptz-get-position', { cameraName });
  }, [appendLog, cameraName, clearPtzError, sendMessage]);

  useEffect(() => {
    if (cameraName === '' || transportState !== 'connected') {
      if (cameraName === '') {
        lastAutoRefreshKeyRef.current = null;
      }
      return;
    }

    const nextAutoRefreshKey = `${cameraName}::${transportState}`;
    if (lastAutoRefreshKeyRef.current === nextAutoRefreshKey) {
      return;
    }

    lastAutoRefreshKeyRef.current = nextAutoRefreshKey;
    refreshPosition();
  }, [cameraName, refreshPosition, transportState]);

  useEffect(() => {
    return () => {
      if (activeDirection !== null && cameraName !== '') {
        sendMessage('ptz-stop', { cameraName });
      }
    };
  }, [activeDirection, cameraName, sendMessage]);

  const beginMove = useCallback(
    (directionId: string, velocity: PtzVelocityCommand) => {
      if (!controlsEnabled) {
        return;
      }

      clearPtzError();
      sendMessage('ptz-start-move', {
        cameraName,
        velocity,
      });
      setActiveDirection(directionId);
    },
    [cameraName, clearPtzError, controlsEnabled, sendMessage],
  );

  const endMove = useCallback(() => {
    if (cameraName === '') {
      return;
    }

    sendMessage('ptz-stop', { cameraName });
    setActiveDirection(null);
  }, [cameraName, sendMessage]);

  const setZoom = useCallback(
    (zoom: number) => {
      if (cameraName === '') {
        return;
      }

      appendLog('info', `Setting PTZ zoom for ${cameraName} to ${zoom.toFixed(2)}`);
      clearPtzError();
      sendMessage('ptz-set-zoom', {
        cameraName,
        zoom,
      });
    },
    [appendLog, cameraName, clearPtzError, sendMessage],
  );

  const goHome = useCallback(() => {
    if (cameraName === '') {
      return;
    }

    appendLog('info', `Sending PTZ home command for ${cameraName}`);
    clearPtzError();
    sendMessage('ptz-go-home', { cameraName });
  }, [appendLog, cameraName, clearPtzError, sendMessage]);

  return useMemo(
    () => ({
      activeDirection,
      beginMove,
      cameraName,
      capabilities,
      controlsEnabled,
      endMove,
      error: ptzError,
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
      ptzError,
      ptzServiceStatus,
      refreshPosition,
      setZoom,
      statusLabel,
    ],
  );
};
