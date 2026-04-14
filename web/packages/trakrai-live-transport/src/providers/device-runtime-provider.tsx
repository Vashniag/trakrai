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
import type { ActivityLogEntry, DeviceStatus, TransportPacket } from '../lib/live-types';

import {
  HEARTBEAT_INTERVAL_MS,
  LOG_LIMIT,
  MS_PER_SECOND,
  STALE_HEARTBEAT_SECONDS,
  createLogEntry,
  getEnvelopeType,
  unwrapPayload,
} from '../lib/live-transport-utils';

export type DeviceRuntimeProviderProps = Readonly<{
  children: ReactNode;
}>;

export type DeviceRuntimeContextValue = {
  appendLog: (level: ActivityLogEntry['level'], message: string) => void;
  clearRuntimeError: () => void;
  deviceStatus: DeviceStatus | null;
  heartbeatAgeSeconds: number | null;
  logs: ActivityLogEntry[];
  runtimeError: string | null;
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

const isDeviceStatusPacket = (packet: TransportPacket): boolean => {
  if ((packet.service ?? '') !== '') {
    return false;
  }

  if (packet.subtopic === 'status') {
    return true;
  }

  return packet.subtopic === 'response' && getEnvelopeType(packet.envelope) === 'status';
};

export const DeviceRuntimeProvider = ({ children }: DeviceRuntimeProviderProps) => {
  const { deviceId, requestDeviceStatus, subscribeToPackets, subscribeToTransportStatus } =
    useLiveTransportContext();
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [heartbeatAt, setHeartbeatAt] = useState<number | null>(null);
  const [heartbeatNow, setHeartbeatNow] = useState<number>(0);
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const staleHeartbeatReportedRef = useRef(false);

  const appendLog = useCallback((level: ActivityLogEntry['level'], message: string) => {
    setLogs((currentLogs) => [createLogEntry(level, message), ...currentLogs].slice(0, LOG_LIMIT));
  }, []);

  useEffect(() => {
    if (deviceId === '') {
      return undefined;
    }

    const unsubscribePackets = subscribeToPackets((packet) => {
      if (isDeviceStatusPacket(packet)) {
        setDeviceStatus(unwrapPayload<DeviceStatus>(packet.envelope));
        setHeartbeatAt(Date.now());
        setRuntimeError(null);
        staleHeartbeatReportedRef.current = false;
        return;
      }

      if (
        (packet.service ?? '') === '' &&
        packet.subtopic === 'response' &&
        packet.envelope.type === 'service-unavailable'
      ) {
        const payload = unwrapPayload<{ error?: string }>(packet.envelope);
        if (typeof payload.error === 'string' && payload.error.trim() !== '') {
          setRuntimeError(payload.error);
          appendLog('error', payload.error);
        }
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

    requestDeviceStatus();

    return () => {
      unsubscribePackets();
      unsubscribeStatus();
      setDeviceStatus(null);
      setHeartbeatAt(null);
      setRuntimeError(null);
      staleHeartbeatReportedRef.current = false;
    };
  }, [appendLog, deviceId, requestDeviceStatus, subscribeToPackets, subscribeToTransportStatus]);

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
      clearRuntimeError: () => {
        setRuntimeError(null);
      },
      deviceStatus: deviceId === '' ? null : deviceStatus,
      heartbeatAgeSeconds: deviceId === '' ? null : heartbeatAgeSeconds,
      logs: deviceId === '' ? [] : logs,
      runtimeError: deviceId === '' ? null : runtimeError,
      setRuntimeError,
    }),
    [appendLog, deviceId, deviceStatus, heartbeatAgeSeconds, logs, runtimeError],
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
