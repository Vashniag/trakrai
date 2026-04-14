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
  LiveTransportMessage,
  TransportConnectionState,
  TransportLayer,
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
  requestStatus: () => void;
  sendMessage: (type: string, payload?: unknown) => void;
  signalingUrl: string;
  subscribeToMessages: (handler: (message: LiveTransportMessage) => void) => () => void;
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
    const liveGateway = useMemo(() => {
      if (!hasValidTransportConfig) {
        return null;
      }

      const gatewayUrl = `${normalizedSignalingUrl}?deviceId=${encodeURIComponent(normalizedDeviceId)}`;
      return new LiveTransportClient(gatewayUrl);
    }, [hasValidTransportConfig, normalizedDeviceId, normalizedSignalingUrl]);
    const [transportState, setTransportState] = useState<TransportConnectionState>('disconnected');
    const [transportError, setTransportError] = useState<string | null>(null);

    useEffect(() => {
      if (liveGateway === null) {
        return undefined;
      }

      const unsubscribeStatus = liveGateway.onStatus((event) => {
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

      liveGateway.connect();

      return () => {
        unsubscribeStatus();
        liveGateway.disconnect();
      };
    }, [liveGateway]);

    const sendMessage = useCallback(
      (type: string, payload?: unknown) => {
        liveGateway?.send(type, payload);
      },
      [liveGateway],
    );

    const requestStatus = useCallback(() => {
      liveGateway?.requestStatus();
    }, [liveGateway]);

    const subscribeToMessages = useCallback(
      (handler: (message: LiveTransportMessage) => void) => {
        if (liveGateway === null) {
          return () => undefined;
        }

        return liveGateway.onMessage(handler);
      },
      [liveGateway],
    );

    const subscribeToTransportStatus = useCallback(
      (handler: (event: LiveTransportStatusEvent) => void) => {
        if (liveGateway === null) {
          return () => undefined;
        }

        return liveGateway.onStatus(handler);
      },
      [liveGateway],
    );

    const value = useMemo<LiveTransportContextValue>(
      () => ({
        deviceId: normalizedDeviceId,
        httpBaseUrl: normalizedHttpBaseUrl,
        requestStatus,
        sendMessage,
        signalingUrl: normalizedSignalingUrl,
        subscribeToMessages,
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
        requestStatus,
        sendMessage,
        subscribeToMessages,
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
