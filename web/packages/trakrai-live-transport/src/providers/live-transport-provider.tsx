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

import type {
  DeviceProtocolNotifyOptions,
  DeviceProtocolRequestOptions,
  DeviceProtocolResponse,
} from '../lib/device-protocol-types';
import type {
  TransportConnectionState,
  TransportLayer,
  TransportPacket,
  TransportPacketDraft,
} from '../lib/live-types';

import { DeviceProtocolRequestError } from '../lib/device-protocol-types';
import { LiveTransportClient, type LiveTransportStatusEvent } from '../lib/live-client';
import {
  createClientRequestId,
  getEnvelopeType,
  normalizeEndpointUrl,
  normalizeOptionalString,
  unwrapPayload,
} from '../lib/live-transport-utils';

export type LiveTransportProviderProps = Readonly<{
  children: ReactNode;
  deviceId: string;
  httpBaseUrl: string;
  signalingUrl: string;
}>;

export type LiveTransportContextValue = {
  deviceId: string;
  httpBaseUrl: string;
  notify: <TPayload extends Record<string, unknown>>(
    options: DeviceProtocolNotifyOptions<TPayload>,
  ) => void;
  request: <TPayload extends Record<string, unknown>, TResponsePayload = unknown>(
    options: DeviceProtocolRequestOptions<TPayload>,
  ) => Promise<DeviceProtocolResponse<TResponsePayload>>;
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

const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_RESPONSE_SUBTOPICS = ['response'] as const;

type PendingRequest = Readonly<{
  reject: (error: DeviceProtocolRequestError<unknown>) => void;
  resolve: (value: DeviceProtocolResponse<unknown>) => void;
  responseSubtopics: ReadonlySet<string>;
  responseTypes: ReadonlySet<string> | null;
  service: string | null;
  timeoutId: number;
}>;

const normalizeServiceName = (service: string | null | undefined): string | null => {
  const normalizedService = service?.trim();
  return normalizedService !== undefined && normalizedService !== '' ? normalizedService : null;
};

const readPacketRequestId = (packet: TransportPacket): string | null => {
  const payload = unwrapPayload<Record<string, unknown>>(packet.envelope);
  const requestId = payload['requestId'];
  return typeof requestId === 'string' && requestId.trim() !== '' ? requestId.trim() : null;
};

const isErrorResponseType = (responseType: string | null): boolean =>
  responseType === 'service-unavailable' ||
  responseType === 'error' ||
  (responseType !== null && responseType.endsWith('-error'));

const readRequestErrorMessage = (
  requestId: string,
  packet: TransportPacket,
  responseType: string | null,
): string => {
  const payload = unwrapPayload<Record<string, unknown>>(packet.envelope);
  const error = payload['error'];
  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }

  return `Device request ${requestId} failed${
    responseType !== null ? ` with ${responseType}` : ''
  }`;
};

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

      return new LiveTransportClient(normalizedSignalingUrl);
    }, [hasValidTransportConfig, normalizedSignalingUrl]);
    const [transportState, setTransportState] = useState<TransportConnectionState>('disconnected');
    const [transportError, setTransportError] = useState<string | null>(null);
    const packetHandlersRef = useRef(new Set<(packet: TransportPacket) => void>());
    const transportStatusHandlersRef = useRef(new Set<(event: LiveTransportStatusEvent) => void>());
    const pendingRequestsRef = useRef(new Map<string, PendingRequest>());
    const activeDeviceIdRef = useRef<string>('');

    const clearPendingRequests = useCallback((reason: string) => {
      const pendingRequests = Array.from(pendingRequestsRef.current.entries());
      pendingRequestsRef.current.clear();

      for (const [requestId, pendingRequest] of pendingRequests) {
        window.clearTimeout(pendingRequest.timeoutId);
        pendingRequest.reject(
          new DeviceProtocolRequestError(reason, {
            requestId,
          }),
        );
      }
    }, []);

    const dispatchPacket = useCallback((packet: TransportPacket) => {
      for (const handler of packetHandlersRef.current) {
        handler(packet);
      }

      const requestId = readPacketRequestId(packet);
      if (requestId === null) {
        return;
      }

      const pendingRequest = pendingRequestsRef.current.get(requestId);
      if (pendingRequest === undefined) {
        return;
      }

      const normalizedPacketService = normalizeServiceName(packet.service);
      if (normalizedPacketService !== pendingRequest.service) {
        return;
      }
      if (!pendingRequest.responseSubtopics.has(packet.subtopic)) {
        return;
      }

      const responseType = getEnvelopeType(packet.envelope);
      if (
        pendingRequest.responseTypes !== null &&
        (responseType === null || !pendingRequest.responseTypes.has(responseType))
      ) {
        return;
      }

      pendingRequestsRef.current.delete(requestId);
      window.clearTimeout(pendingRequest.timeoutId);

      const payload = unwrapPayload<unknown>(packet.envelope);
      if (isErrorResponseType(responseType)) {
        pendingRequest.reject(
          new DeviceProtocolRequestError(readRequestErrorMessage(requestId, packet, responseType), {
            packet,
            payload,
            requestId,
            responseType,
          }),
        );
        return;
      }

      pendingRequest.resolve({
        packet,
        payload,
        requestId,
        responseType,
      });
    }, []);

    const emitTransportStatus = useCallback((event: LiveTransportStatusEvent) => {
      for (const handler of transportStatusHandlersRef.current) {
        handler(event);
      }
    }, []);

    useEffect(() => {
      if (transportClient === null) {
        return undefined;
      }

      const unsubscribePackets = transportClient.onMessage((packet) => {
        dispatchPacket(packet);
      });
      const unsubscribeStatus = transportClient.onStatus((event) => {
        emitTransportStatus(event);
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
        unsubscribePackets();
        unsubscribeStatus();
        transportClient.disconnect();
        clearPendingRequests('Transport connection was reset');
      };
    }, [clearPendingRequests, dispatchPacket, emitTransportStatus, transportClient]);

    useEffect(() => {
      if (transportClient === null || normalizedDeviceId === '') {
        return;
      }

      if (
        activeDeviceIdRef.current !== '' &&
        activeDeviceIdRef.current !== normalizedDeviceId &&
        pendingRequestsRef.current.size > 0
      ) {
        clearPendingRequests(`Device target changed from ${activeDeviceIdRef.current} to ${normalizedDeviceId}`);
      }

      activeDeviceIdRef.current = normalizedDeviceId;
      transportClient.setDevice(normalizedDeviceId);
    }, [clearPendingRequests, normalizedDeviceId, transportClient]);

    useEffect(
      () => () => {
        clearPendingRequests('Transport provider was unmounted');
      },
      [clearPendingRequests],
    );

    const notify = useCallback(
      <TPayload extends Record<string, unknown>>(options: DeviceProtocolNotifyOptions<TPayload>) => {
        const normalizedType = options.type.trim();
        const normalizedSubtopic = (options.subtopic ?? 'command').trim();
        if (normalizedType === '' || normalizedSubtopic === '') {
          return;
        }

        transportClient?.sendPacket({
          payload: options.payload ?? {},
          service: normalizeServiceName(options.service),
          subtopic: normalizedSubtopic,
          type: normalizedType,
        });
      },
      [transportClient],
    );

    const sendPacket = useCallback(
      (packet: TransportPacketDraft) => {
        notify({
          payload:
            typeof packet.payload === 'object' && packet.payload !== null
              ? (packet.payload as Record<string, unknown>)
              : {},
          service: packet.service,
          subtopic: packet.subtopic,
          type: packet.type,
        });
      },
      [notify],
    );

    const requestDeviceStatus = useCallback(() => {
      notify({
        payload: {},
        subtopic: 'command',
        type: 'get-status',
      });
    }, [notify]);

    const request = useCallback(
      <TPayload extends Record<string, unknown>, TResponsePayload = unknown>(
        options: DeviceProtocolRequestOptions<TPayload>,
      ) => {
        const normalizedCommand = options.command.trim();
        const normalizedSubtopic = (options.subtopic ?? 'command').trim();
        const normalizedService = normalizeServiceName(options.service);
        if (!hasValidTransportConfig || normalizedCommand === '' || normalizedSubtopic === '') {
          return Promise.reject(
            new DeviceProtocolRequestError('Device protocol request is not configured correctly.', {
              requestId: createClientRequestId(),
            }),
          ) as Promise<DeviceProtocolResponse<TResponsePayload>>;
        }

        const requestId = normalizeOptionalString(options.requestId) ?? createClientRequestId();
        const responseSubtopics = new Set(
          (options.responseSubtopics ?? DEFAULT_RESPONSE_SUBTOPICS)
            .map((subtopic) => subtopic.trim())
            .filter((subtopic) => subtopic !== ''),
        );
        if (responseSubtopics.size === 0) {
          responseSubtopics.add('response');
        }
        const responseTypes =
          options.responseTypes !== undefined && options.responseTypes.length > 0
            ? new Set(
                options.responseTypes
                  .map((type) => type.trim())
                  .filter((type) => type !== ''),
              )
            : null;

        return new Promise<DeviceProtocolResponse<TResponsePayload>>((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            pendingRequestsRef.current.delete(requestId);
            reject(
              new DeviceProtocolRequestError(
                `Timed out waiting for ${normalizedService ?? 'device'}:${normalizedCommand}`,
                {
                  requestId,
                },
              ),
            );
          }, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

          pendingRequestsRef.current.set(requestId, {
            reject: reject as PendingRequest['reject'],
            resolve: resolve as PendingRequest['resolve'],
            responseSubtopics,
            responseTypes,
            service: normalizedService,
            timeoutId,
          });

          const requestPayload: Record<string, unknown> = {
            ...(options.payload ?? {}),
            requestId,
          };

          notify({
            payload: requestPayload,
            service: normalizedService,
            subtopic: normalizedSubtopic,
            type: normalizedCommand,
          });
        });
      },
      [hasValidTransportConfig, notify],
    );

    const setDevice = useCallback(
      (nextDeviceId: string) => {
        transportClient?.setDevice(nextDeviceId);
      },
      [transportClient],
    );

    const subscribeToPackets = useCallback(
      (handler: (packet: TransportPacket) => void) => {
        packetHandlersRef.current.add(handler);
        return () => {
          packetHandlersRef.current.delete(handler);
        };
      },
      [],
    );

    const subscribeToTransportStatus = useCallback(
      (handler: (event: LiveTransportStatusEvent) => void) => {
        transportStatusHandlersRef.current.add(handler);
        return () => {
          transportStatusHandlersRef.current.delete(handler);
        };
      },
      [],
    );

    const value = useMemo<LiveTransportContextValue>(
      () => ({
        deviceId: normalizedDeviceId,
        httpBaseUrl: normalizedHttpBaseUrl,
        notify,
        request,
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
        notify,
        request,
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
