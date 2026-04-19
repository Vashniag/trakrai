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
  ActivityLogEntry,
  DeviceStatus,
  TransportConnectionState,
  TransportLayer,
  TransportPacket,
  TransportPacketDraft,
} from '../lib/live-types';

import {
  DeviceProtocolRequestError,
  type DeviceProtocolNotifyOptions,
  type DeviceProtocolRequestOptions,
  type DeviceProtocolResponse,
} from '../lib/device-protocol-types';
import { LiveTransportClient, type LiveTransportStatusEvent } from '../lib/live-client';
import {
  HEARTBEAT_INTERVAL_MS,
  LOG_LIMIT,
  MS_PER_SECOND,
  STALE_HEARTBEAT_SECONDS,
  createClientRequestId,
  createLogEntry,
  getEnvelopeType,
  normalizeEndpointUrl,
  normalizeOptionalString,
  unwrapPayload,
} from '../lib/live-transport-utils';

export type LiveTransportProviderProps = Readonly<{
  children: ReactNode;
  deviceId: string;
  gatewayAccessToken?: string;
  httpBaseUrl: string;
  signalingUrl: string;
}>;

export type LiveTransportContextValue = {
  appendLog: (level: ActivityLogEntry['level'], message: string) => void;
  clearRuntimeError: () => void;
  deviceId: string;
  deviceStatus: DeviceStatus | null;
  gatewayAccessToken: string;
  heartbeatAgeSeconds: number | null;
  httpBaseUrl: string;
  logs: ActivityLogEntry[];
  notify: <TPayload extends Record<string, unknown>>(
    options: DeviceProtocolNotifyOptions<TPayload>,
  ) => void;
  request: <TPayload extends Record<string, unknown>, TResponsePayload = unknown>(
    options: DeviceProtocolRequestOptions<TPayload>,
  ) => Promise<DeviceProtocolResponse<TResponsePayload>>;
  requestDeviceStatus: () => void;
  runtimeError: string | null;
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

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_RESPONSE_SUBTOPICS = ['response'] as const;

type PendingRequest = Readonly<{
  reject: (error: DeviceProtocolRequestError<unknown>) => void;
  resolve: (value: DeviceProtocolResponse<unknown>) => void;
  responseSubtopics: ReadonlySet<string>;
  responseTypes: ReadonlySet<string> | null;
  service: string | null;
  timeoutId: number;
}>;

type DeviceViewState = Readonly<{
  deviceId: string;
  deviceStatus: DeviceStatus | null;
  heartbeatAt: number | null;
  heartbeatNow: number;
  logs: ActivityLogEntry[];
  runtimeError: string | null;
}>;

const createDeviceViewState = (deviceId: string): DeviceViewState => ({
  deviceId,
  deviceStatus: null,
  heartbeatAt: null,
  heartbeatNow: 0,
  logs: [],
  runtimeError: null,
});

const getScopedDeviceViewState = (
  currentState: DeviceViewState,
  deviceId: string,
): DeviceViewState =>
  currentState.deviceId === deviceId ? currentState : createDeviceViewState(deviceId);

const clearRuntimeErrorForDeviceState = (
  currentState: DeviceViewState,
  deviceId: string,
): DeviceViewState => ({
  ...getScopedDeviceViewState(currentState, deviceId),
  runtimeError: null,
});

const setHeartbeatNowForDeviceState = (
  currentState: DeviceViewState,
  deviceId: string,
  heartbeatNow: number,
): DeviceViewState => ({
  ...getScopedDeviceViewState(currentState, deviceId),
  heartbeatNow,
});

const normalizeServiceName = (service: string | null | undefined): string | null => {
  const normalizedService = service?.trim();
  return normalizedService !== undefined && normalizedService !== '' ? normalizedService : null;
};

const appendGatewayAccessToken = (url: string, gatewayAccessToken: string): string => {
  if (url === '' || gatewayAccessToken === '') {
    return url;
  }

  const parsedUrl = new URL(url);
  parsedUrl.searchParams.set('gatewayAccessToken', gatewayAccessToken);
  return parsedUrl.toString();
};

const readPacketRequestId = (packet: TransportPacket): string | null => {
  const payload = unwrapPayload<Record<string, unknown>>(packet.envelope);
  const { requestId } = payload;
  return typeof requestId === 'string' && requestId.trim() !== '' ? requestId.trim() : null;
};

const isErrorResponseType = (responseType: string | null): boolean =>
  responseType === 'service-unavailable' ||
  responseType === 'error' ||
  (responseType?.endsWith('-error') ?? false);

const readRequestErrorMessage = (
  requestId: string,
  packet: TransportPacket,
  responseType: string | null,
): string => {
  const payload = unwrapPayload<Record<string, unknown>>(packet.envelope);
  const { error } = payload;
  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }

  return `Device request ${requestId} failed${
    responseType !== null ? ` with ${responseType}` : ''
  }`;
};

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

const rejectTimedOutRequest = (
  pendingRequests: Map<string, PendingRequest>,
  requestId: string,
  service: string | null,
  command: string,
  reject: PendingRequest['reject'],
) => {
  pendingRequests.delete(requestId);
  reject(
    new DeviceProtocolRequestError(`Timed out waiting for ${service ?? 'device'}:${command}`, {
      requestId,
    }),
  );
};

const createTransportProvider = (transportMode: TransportLayer) => {
  const TransportProvider = ({
    children,
    deviceId,
    gatewayAccessToken,
    httpBaseUrl,
    signalingUrl,
  }: LiveTransportProviderProps) => {
    const normalizedDeviceId = deviceId.trim();
    const normalizedGatewayAccessToken = normalizeOptionalString(gatewayAccessToken) ?? '';
    const normalizedHttpBaseUrl = normalizeEndpointUrl(httpBaseUrl);
    const normalizedSignalingUrl = normalizeEndpointUrl(signalingUrl);
    const authorizedSignalingUrl = appendGatewayAccessToken(
      normalizedSignalingUrl,
      normalizedGatewayAccessToken,
    );
    const hasValidTransportConfig =
      normalizedDeviceId !== '' &&
      normalizedHttpBaseUrl !== '' &&
      authorizedSignalingUrl !== '' &&
      (transportMode === 'edge' || normalizedGatewayAccessToken !== '');
    const transportClient = useMemo(() => {
      if (!hasValidTransportConfig) {
        return null;
      }

      return new LiveTransportClient(authorizedSignalingUrl);
    }, [authorizedSignalingUrl, hasValidTransportConfig]);
    const [transportState, setTransportState] = useState<TransportConnectionState>('disconnected');
    const [transportError, setTransportError] = useState<string | null>(null);
    const [deviceViewState, setDeviceViewState] = useState<DeviceViewState>(() =>
      createDeviceViewState(normalizedDeviceId),
    );
    const packetHandlersRef = useRef(new Set<(packet: TransportPacket) => void>());
    const transportStatusHandlersRef = useRef(new Set<(event: LiveTransportStatusEvent) => void>());
    const pendingRequestsRef = useRef(new Map<string, PendingRequest>());
    const activeDeviceIdRef = useRef<string>('');
    const staleHeartbeatReportedRef = useRef(false);

    const appendLog = useCallback(
      (level: ActivityLogEntry['level'], message: string) => {
        setDeviceViewState((currentState) => {
          const nextState = getScopedDeviceViewState(currentState, normalizedDeviceId);

          return {
            ...nextState,
            logs: [createLogEntry(level, message), ...nextState.logs].slice(0, LOG_LIMIT),
          };
        });
      },
      [normalizedDeviceId],
    );

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

    const dispatchPacket = useCallback(
      (packet: TransportPacket) => {
        for (const handler of packetHandlersRef.current) {
          handler(packet);
        }

        if (isDeviceStatusPacket(packet)) {
          const nextDeviceStatus = unwrapPayload<DeviceStatus>(packet.envelope);
          const nextHeartbeatAt = Date.now();
          setDeviceViewState((currentState) => ({
            ...getScopedDeviceViewState(currentState, normalizedDeviceId),
            deviceStatus: nextDeviceStatus,
            heartbeatAt: nextHeartbeatAt,
            heartbeatNow: nextHeartbeatAt,
            runtimeError: null,
          }));
          staleHeartbeatReportedRef.current = false;
        } else if (
          (packet.service ?? '') === '' &&
          packet.subtopic === 'response' &&
          packet.envelope.type === 'service-unavailable'
        ) {
          const payload = unwrapPayload<{ error?: string }>(packet.envelope);
          if (typeof payload.error === 'string' && payload.error.trim() !== '') {
            setDeviceViewState((currentState) => ({
              ...getScopedDeviceViewState(currentState, normalizedDeviceId),
              runtimeError: payload.error ?? null,
            }));
            appendLog('error', payload.error);
          }
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
            new DeviceProtocolRequestError(
              readRequestErrorMessage(requestId, packet, responseType),
              {
                packet,
                payload,
                requestId,
                responseType,
              },
            ),
          );
          return;
        }

        pendingRequest.resolve({
          packet,
          payload,
          requestId,
          responseType,
        });
      },
      [appendLog, normalizedDeviceId],
    );

    const emitTransportStatus = useCallback((event: LiveTransportStatusEvent) => {
      for (const handler of transportStatusHandlersRef.current) {
        handler(event);
      }
    }, []);

    useEffect(() => {
      if (transportClient === null) {
        return undefined;
      }

      const unsubscribePackets = transportClient.onMessage((packet: TransportPacket) => {
        dispatchPacket(packet);
      });
      const unsubscribeStatus = transportClient.onStatus((event: LiveTransportStatusEvent) => {
        emitTransportStatus(event);

        const message = readTransportStatusMessage(event);
        if (message !== null) {
          let level: ActivityLogEntry['level'] = 'warn';
          if (event.type === 'error') {
            level = 'error';
          } else if (event.type === 'open') {
            level = 'info';
          }
          appendLog(level, message);
        }

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
    }, [appendLog, clearPendingRequests, dispatchPacket, emitTransportStatus, transportClient]);

    useEffect(() => {
      if (transportClient === null || normalizedDeviceId === '') {
        return;
      }

      if (
        activeDeviceIdRef.current !== '' &&
        activeDeviceIdRef.current !== normalizedDeviceId &&
        pendingRequestsRef.current.size > 0
      ) {
        clearPendingRequests(
          `Device target changed from ${activeDeviceIdRef.current} to ${normalizedDeviceId}`,
        );
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
      <TPayload extends Record<string, unknown>>(
        options: DeviceProtocolNotifyOptions<TPayload>,
      ) => {
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

    const clearRuntimeError = useCallback(() => {
      setDeviceViewState((currentState) =>
        clearRuntimeErrorForDeviceState(currentState, normalizedDeviceId),
      );
    }, [normalizedDeviceId]);

    const syncHeartbeatNow = useCallback(
      (nextHeartbeatNow: number) => {
        setDeviceViewState((currentState) =>
          setHeartbeatNowForDeviceState(currentState, normalizedDeviceId, nextHeartbeatNow),
        );
      },
      [normalizedDeviceId],
    );
    const scopedDeviceViewState = getScopedDeviceViewState(deviceViewState, normalizedDeviceId);

    useEffect(() => {
      if (normalizedDeviceId === '' || transportState !== 'connected') {
        return;
      }

      requestDeviceStatus();
    }, [normalizedDeviceId, requestDeviceStatus, transportState]);

    useEffect(() => {
      if (normalizedDeviceId === '') {
        return undefined;
      }

      const timer = window.setInterval(() => {
        const nextHeartbeatNow = Date.now();
        syncHeartbeatNow(nextHeartbeatNow);

        if (scopedDeviceViewState.heartbeatAt === null) {
          return;
        }

        const nextHeartbeatAgeSeconds = Math.max(
          0,
          Math.floor((nextHeartbeatNow - scopedDeviceViewState.heartbeatAt) / MS_PER_SECOND),
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
    }, [appendLog, normalizedDeviceId, scopedDeviceViewState.heartbeatAt, syncHeartbeatNow]);

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
        const responseSubtopics = new Set<string>(
          (options.responseSubtopics ?? DEFAULT_RESPONSE_SUBTOPICS)
            .map((subtopic: string) => subtopic.trim())
            .filter((subtopic: string) => subtopic !== ''),
        );
        if (responseSubtopics.size === 0) {
          responseSubtopics.add('response');
        }
        const responseTypes =
          options.responseTypes !== undefined && options.responseTypes.length > 0
            ? new Set<string>(
                options.responseTypes
                  .map((type: string) => type.trim())
                  .filter((type: string) => type !== ''),
              )
            : null;

        return new Promise<DeviceProtocolResponse<TResponsePayload>>((resolve, reject) => {
          const timeoutId = window.setTimeout(
            rejectTimedOutRequest,
            options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
            pendingRequestsRef.current,
            requestId,
            normalizedService,
            normalizedCommand,
            reject as PendingRequest['reject'],
          );

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

    const subscribeToPackets = useCallback((handler: (packet: TransportPacket) => void) => {
      packetHandlersRef.current.add(handler);
      return () => {
        packetHandlersRef.current.delete(handler);
      };
    }, []);

    const subscribeToTransportStatus = useCallback(
      (handler: (event: LiveTransportStatusEvent) => void) => {
        transportStatusHandlersRef.current.add(handler);
        return () => {
          transportStatusHandlersRef.current.delete(handler);
        };
      },
      [],
    );
    const heartbeatAgeSeconds =
      scopedDeviceViewState.heartbeatAt === null
        ? null
        : Math.max(
            0,
            Math.floor(
              (scopedDeviceViewState.heartbeatNow - scopedDeviceViewState.heartbeatAt) /
                MS_PER_SECOND,
            ),
          );

    const value = useMemo<LiveTransportContextValue>(
      () => ({
        appendLog,
        clearRuntimeError,
        deviceId: normalizedDeviceId,
        deviceStatus: normalizedDeviceId === '' ? null : scopedDeviceViewState.deviceStatus,
        gatewayAccessToken: normalizedGatewayAccessToken,
        heartbeatAgeSeconds: normalizedDeviceId === '' ? null : heartbeatAgeSeconds,
        httpBaseUrl: normalizedHttpBaseUrl,
        logs: normalizedDeviceId === '' ? [] : scopedDeviceViewState.logs,
        notify,
        request,
        requestDeviceStatus,
        runtimeError: normalizedDeviceId === '' ? null : scopedDeviceViewState.runtimeError,
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
        appendLog,
        clearRuntimeError,
        hasValidTransportConfig,
        heartbeatAgeSeconds,
        normalizedDeviceId,
        normalizedHttpBaseUrl,
        normalizedSignalingUrl,
        notify,
        request,
        requestDeviceStatus,
        scopedDeviceViewState,
        sendPacket,
        setDevice,
        subscribeToPackets,
        subscribeToTransportStatus,
        normalizedGatewayAccessToken,
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

export const useLiveTransport = (): LiveTransportContextValue => {
  const context = useContext(LiveTransportContext);
  if (context === null) {
    throw new Error('useLiveTransport must be used within a transport provider.');
  }

  return context;
};
