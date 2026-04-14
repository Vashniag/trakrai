'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type {
  TransportConnectionState,
  TransportLayer,
  TransportPacket,
  TransportPacketDraft,
} from '../lib/live-types';

import { LiveTransportClient, type LiveTransportStatusEvent } from '../lib/live-client';
import { normalizeEndpointUrl } from '../lib/live-transport-utils';

export type LiveTransportProviderProps = Readonly<{
  children: ReactNode;
  deviceId: string;
  httpBaseUrl: string;
  signalingUrl: string;
}>;

export type LiveTransportContextValue = {
  deviceId: string;
  httpBaseUrl: string;
  requestDeviceStatus: () => void;
  sendPacket: (packet: TransportPacketDraft) => void;
  setDevice: (deviceId: string) => void;
  signalingUrl: string;
  subscribeToPackets: (handler: (packet: TransportPacket) => void) => () => void;
  subscribeToTransportStatus: (handler: (event: LiveTransportStatusEvent) => void) => () => void;
  transportError: string | null;
  transportMode: TransportLayer;
  transportState: TransportConnectionState;
};

const LiveTransportContext = createContext<LiveTransportContextValue | null>(null);

const createTransportProvider = (transportMode: TransportLayer) => {
  const TransportProvider = ({
    children,
    deviceId,
    httpBaseUrl,
    signalingUrl,
  }: LiveTransportProviderProps) => {
    const normalizedDeviceId = deviceId.trim();
    const normalizedHttpBaseUrl = normalizeEndpointUrl(httpBaseUrl);
    const normalizedSignalingUrl = normalizeEndpointUrl(signalingUrl);
    const hasValidTransportConfig =
      normalizedDeviceId !== '' && normalizedHttpBaseUrl !== '' && normalizedSignalingUrl !== '';
    const transportClient = useMemo(() => {
      if (!hasValidTransportConfig) {
        return null;
      }

      const gatewayUrl = `${normalizedSignalingUrl}?deviceId=${encodeURIComponent(normalizedDeviceId)}`;
      return new LiveTransportClient(gatewayUrl);
    }, [hasValidTransportConfig, normalizedDeviceId, normalizedSignalingUrl]);
    const [transportState, setTransportState] = useState<TransportConnectionState>('disconnected');
    const [transportError, setTransportError] = useState<string | null>(null);

    useEffect(() => {
      if (transportClient === null) {
        return undefined;
      }

      const unsubscribeStatus = transportClient.onStatus((event) => {
        switch (event.type) {
          case 'connecting':
            setTransportState(event.attempt > 1 ? 'reconnecting' : 'connecting');
            break;
          case 'open':
            setTransportState('connected');
            setTransportError(null);
            break;
          case 'closed':
            setTransportState('reconnecting');
            break;
          case 'reconnect-scheduled':
            setTransportState('reconnecting');
            break;
          case 'error':
            setTransportError(event.message ?? 'Gateway transport error');
            break;
          default:
            break;
        }
      });

      transportClient.connect();

      return () => {
        unsubscribeStatus();
        transportClient.disconnect();
      };
    }, [transportClient]);

    useEffect(() => {
      if (transportClient === null || normalizedDeviceId === '') {
        return;
      }

      transportClient.setDevice(normalizedDeviceId);
    }, [normalizedDeviceId, transportClient]);

    const sendPacket = useCallback(
      (packet: TransportPacketDraft) => {
        transportClient?.sendPacket(packet);
      },
      [transportClient],
    );

    const requestDeviceStatus = useCallback(() => {
      transportClient?.requestStatus();
    }, [transportClient]);

    const setDevice = useCallback(
      (nextDeviceId: string) => {
        transportClient?.setDevice(nextDeviceId);
      },
      [transportClient],
    );

    const subscribeToPackets = useCallback(
      (handler: (packet: TransportPacket) => void) => {
        if (transportClient === null) {
          return () => undefined;
        }

        return transportClient.onMessage(handler);
      },
      [transportClient],
    );

    const subscribeToTransportStatus = useCallback(
      (handler: (event: LiveTransportStatusEvent) => void) => {
        if (transportClient === null) {
          return () => undefined;
        }

        return transportClient.onStatus(handler);
      },
      [transportClient],
    );

    const value = useMemo<LiveTransportContextValue>(
      () => ({
        deviceId: normalizedDeviceId,
        httpBaseUrl: normalizedHttpBaseUrl,
        requestDeviceStatus,
        sendPacket,
        setDevice,
        signalingUrl: normalizedSignalingUrl,
        subscribeToPackets,
        subscribeToTransportStatus,
        transportError: hasValidTransportConfig ? transportError : null,
        transportMode,
        transportState: !hasValidTransportConfig ? 'disconnected' : transportState,
      }),
      [
        hasValidTransportConfig,
        normalizedDeviceId,
        normalizedHttpBaseUrl,
        normalizedSignalingUrl,
        requestDeviceStatus,
        sendPacket,
        setDevice,
        subscribeToPackets,
        subscribeToTransportStatus,
        transportError,
        transportState,
      ],
    );

    return <LiveTransportContext.Provider value={value}>{children}</LiveTransportContext.Provider>;
  };

  TransportProvider.displayName =
    transportMode === 'cloud' ? 'CloudTransportProvider' : 'EdgeTransportProvider';

  return TransportProvider;
};

export const CloudTransportProvider = createTransportProvider('cloud');
export const EdgeTransportProvider = createTransportProvider('edge');

export const useLiveTransportContext = (): LiveTransportContextValue => {
  const context = useContext(LiveTransportContext);
  if (context === null) {
    throw new Error('useLiveTransportContext must be used within a transport provider.');
  }

  return context;
};
