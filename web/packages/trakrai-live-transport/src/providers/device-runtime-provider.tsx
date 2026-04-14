'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useLiveTransportContext } from './live-transport-provider';

import type { LiveTransportStatusEvent } from '../lib/live-client';
import type {
  ActivityLogEntry,
  DeviceStatus,
  PtzCapabilities,
  PtzPosition,
  PtzState,
} from '../lib/live-types';

import {
  HEARTBEAT_INTERVAL_MS,
  LOG_LIMIT,
  MS_PER_SECOND,
  STALE_HEARTBEAT_SECONDS,
  createLogEntry,
  getEnvelopeType,
  normalizeOptionalString,
  readPtzState,
  unwrapPayload,
} from '../lib/live-transport-utils';

export type DeviceRuntimeProviderProps = Readonly<{
  children: ReactNode;
}>;

export type DeviceRuntimeContextValue = {
  appendLog: (level: ActivityLogEntry['level'], message: string) => void;
  clearPtzError: () => void;
  clearRuntimeError: () => void;
  deviceStatus: DeviceStatus | null;
  heartbeatAgeSeconds: number | null;
  logs: ActivityLogEntry[];
  ptzError: string | null;
  ptzState: PtzState | null;
  runtimeError: string | null;
  setPtzError: (message: string | null) => void;
  setRuntimeError: (message: string | null) => void;
};

const DeviceRuntimeContext = createContext<DeviceRuntimeContextValue | null>(null);

const readTransportStatusMessage = (event: LiveTransportStatusEvent): string | null => {
  switch (event.type) {
    case 'connecting':
      return `Opening gateway socket (attempt ${event.attempt})`;
    case 'open':
      return 'Gateway socket connected';
    case 'closed':
      return `Gateway socket closed${event.reason !== undefined ? ` (${event.reason})` : ''}`;
    case 'reconnect-scheduled':
      return `Retrying gateway connection in ${event.delayMs}ms`;
    case 'error':
      return event.message ?? 'Gateway transport error';
    default:
      return null;
  }
};

export const DeviceRuntimeProvider = ({ children }: DeviceRuntimeProviderProps) => {
  const { deviceId, requestStatus, subscribeToMessages, subscribeToTransportStatus } =
    useLiveTransportContext();
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [heartbeatAt, setHeartbeatAt] = useState<number | null>(null);
  const [heartbeatNow, setHeartbeatNow] = useState<number>(0);
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [ptzError, setPtzError] = useState<string | null>(null);
  const [ptzState, setPtzState] = useState<PtzState | null>(null);
  const staleHeartbeatReportedRef = useRef(false);

  const appendLog = useCallback((level: ActivityLogEntry['level'], message: string) => {
    setLogs((currentLogs) => [createLogEntry(level, message), ...currentLogs].slice(0, LOG_LIMIT));
  }, []);

  const applyDeviceStatus = useCallback((nextStatus: DeviceStatus) => {
    setDeviceStatus(nextStatus);
    const nextPtzState = readPtzState(nextStatus.services?.['ptz-control']);
    if (nextPtzState !== null) {
      setPtzState(nextPtzState);
      setPtzError(nextPtzState.lastError);
    }
  }, []);

  useEffect(() => {
    if (deviceId === '') {
      return undefined;
    }

    const unsubscribeMessages = subscribeToMessages((message) => {
      switch (message.type) {
        case 'device-status': {
          const nextStatus = unwrapPayload<DeviceStatus>(message.payload);
          applyDeviceStatus(nextStatus);
          setHeartbeatAt(Date.now());
          setRuntimeError(null);
          staleHeartbeatReportedRef.current = false;
          break;
        }
        case 'device-response': {
          const payload = unwrapPayload<{
            error?: string;
          }>(message.payload);
          const responseType = getEnvelopeType(message.payload) ?? undefined;

          if (responseType === 'status') {
            const nextStatus = unwrapPayload<DeviceStatus>(message.payload);
            applyDeviceStatus(nextStatus);
            setHeartbeatAt(Date.now());
            setRuntimeError(null);
            staleHeartbeatReportedRef.current = false;
            appendLog('info', 'Device status snapshot refreshed');
            return;
          }

          if (responseType === 'service-unavailable' && payload.error !== undefined) {
            setRuntimeError(payload.error);
            appendLog('error', payload.error);
          }
          break;
        }
        case 'ptz-status': {
          const payload = unwrapPayload<Omit<PtzState, 'status'>>(message.payload);
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
          break;
        }
        case 'ptz-response': {
          const responseType = getEnvelopeType(message.payload);
          if (responseType === null) {
            break;
          }

          if (responseType === 'ptz-position') {
            const payload = unwrapPayload<PtzPosition>(message.payload);
            setPtzState((currentState) => ({
              activeCamera: payload.cameraName,
              capabilities: payload.capabilities ?? currentState?.capabilities ?? null,
              configuredCameras: currentState?.configuredCameras ?? [],
              lastCommand: 'get-position',
              lastError: null,
              position: payload,
              status: currentState?.status ?? 'idle',
            }));
            setPtzError(null);
            appendLog('info', `PTZ position refreshed for ${payload.cameraName}`);
            break;
          }

          if (responseType === 'ptz-command-ack') {
            const payload = unwrapPayload<{
              capabilities?: PtzCapabilities | null;
              cameraName: string;
              command: string;
              position?: PtzPosition;
            }>(message.payload);
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
            break;
          }

          if (responseType === 'ptz-error' || responseType === 'service-unavailable') {
            const payload = unwrapPayload<{
              cameraName?: string;
              command?: string;
              error?: string;
              requestType?: string;
            }>(message.payload);
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
          break;
        }
        default:
          break;
      }
    });

    const unsubscribeStatus = subscribeToTransportStatus((event) => {
      const message = readTransportStatusMessage(event);
      if (message === null) {
        return;
      }

      let level: ActivityLogEntry['level'] = 'warn';
      if (event.type === 'error') {
        level = 'error';
      } else if (event.type === 'open') {
        level = 'info';
      }
      appendLog(level, message);
    });

    requestStatus();

    return () => {
      unsubscribeMessages();
      unsubscribeStatus();
      setDeviceStatus(null);
      setHeartbeatAt(null);
      setRuntimeError(null);
      setPtzError(null);
      setPtzState(null);
      staleHeartbeatReportedRef.current = false;
    };
  }, [
    appendLog,
    applyDeviceStatus,
    deviceId,
    requestStatus,
    subscribeToMessages,
    subscribeToTransportStatus,
  ]);

  useEffect(() => {
    if (deviceId === '') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      const nextHeartbeatNow = Date.now();
      setHeartbeatNow(nextHeartbeatNow);

      if (heartbeatAt === null) {
        return;
      }

      const nextHeartbeatAgeSeconds = Math.max(
        0,
        Math.floor((nextHeartbeatNow - heartbeatAt) / MS_PER_SECOND),
      );
      if (
        nextHeartbeatAgeSeconds >= STALE_HEARTBEAT_SECONDS &&
        !staleHeartbeatReportedRef.current
      ) {
        staleHeartbeatReportedRef.current = true;
        appendLog('warn', `Device heartbeat is stale (${nextHeartbeatAgeSeconds}s)`);
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [appendLog, deviceId, heartbeatAt]);

  const heartbeatAgeSeconds =
    heartbeatAt === null
      ? null
      : Math.max(0, Math.floor((heartbeatNow - heartbeatAt) / MS_PER_SECOND));

  const value = useMemo<DeviceRuntimeContextValue>(
    () => ({
      appendLog,
      clearPtzError: () => {
        setPtzError(null);
      },
      clearRuntimeError: () => {
        setRuntimeError(null);
      },
      deviceStatus: deviceId === '' ? null : deviceStatus,
      heartbeatAgeSeconds: deviceId === '' ? null : heartbeatAgeSeconds,
      logs: deviceId === '' ? [] : logs,
      ptzError: deviceId === '' ? null : ptzError,
      ptzState: deviceId === '' ? null : ptzState,
      runtimeError: deviceId === '' ? null : runtimeError,
      setPtzError,
      setRuntimeError,
    }),
    [
      appendLog,
      deviceId,
      deviceStatus,
      heartbeatAgeSeconds,
      logs,
      ptzError,
      ptzState,
      runtimeError,
    ],
  );

  return <DeviceRuntimeContext.Provider value={value}>{children}</DeviceRuntimeContext.Provider>;
};

export const useDeviceRuntimeContext = (): DeviceRuntimeContextValue => {
  const context = useContext(DeviceRuntimeContext);
  if (context === null) {
    throw new Error('useDeviceRuntimeContext must be used within a device runtime provider.');
  }

  return context;
};
