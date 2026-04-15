import type { Server } from 'http';

import { WebSocket, WebSocketServer } from 'ws';

import { config } from './config.js';
import {
  onMqttMessage,
  parseDeviceTopic,
  publishMqtt,
  subscribeToDevice,
  unsubscribeFromDevice,
} from './mqtt-client.js';

type ClientContext = {
  deviceId: string;
};

type GatewayWebSocketRateLimit = {
  maxCommandMessages: number;
  maxMessages: number;
  maxPayloadBytes: number;
  windowMs: number;
};

type WebSocketDependencies = {
  now: () => number;
  onMqttMessage: typeof onMqttMessage;
  parseDeviceTopic: typeof parseDeviceTopic;
  publishMqtt: typeof publishMqtt;
  subscribeToDevice: typeof subscribeToDevice;
  unsubscribeFromDevice: typeof unsubscribeFromDevice;
  warn: (message: string) => void;
};

export type WebSocketSetupOptions = {
  deps?: Partial<WebSocketDependencies>;
  rateLimit?: GatewayWebSocketRateLimit;
};

type TransportEnvelope = {
  msgId?: string;
  payload?: unknown;
  timestamp?: string;
  type: string;
};

type TransportPacket = {
  deviceId: string;
  envelope: TransportEnvelope;
  service: string | null;
  subtopic: string;
};

type PacketFrame = {
  envelope: TransportEnvelope;
  kind: 'packet';
  service?: string | null;
  subtopic: string;
};

type SetDeviceFrame = {
  deviceId?: string;
  kind: 'set-device';
};

type InboundFrame = PacketFrame | SetDeviceFrame;

const clients = new Map<WebSocket, ClientContext>();
const requestOwners = new Map<string, WebSocket>();
const sessionOwners = new Map<string, WebSocket>();
const clientRequests = new Map<WebSocket, Set<string>>();
const clientSessions = new Map<WebSocket, Set<string>>();
const lastKnownStatuses = new Map<string, TransportPacket>();
const inboundRateLimits = new Map<
  WebSocket,
  { commandTimestamps: number[]; messageTimestamps: number[] }
>();
const defaultGatewayRateLimit: GatewayWebSocketRateLimit = {
  maxCommandMessages: 40,
  maxMessages: 120,
  maxPayloadBytes: 1024 * 1024,
  windowMs: 5000,
};

const defaultWebSocketDependencies: WebSocketDependencies = {
  now: () => Date.now(),
  onMqttMessage,
  parseDeviceTopic,
  publishMqtt,
  subscribeToDevice,
  unsubscribeFromDevice,
  warn: (message: string) => {
    console.warn(`[ws] ${message}`);
  },
};

const normalizeGatewayRateLimit = (
  rateLimit: GatewayWebSocketRateLimit | undefined,
): GatewayWebSocketRateLimit => {
  const candidate = rateLimit ?? defaultGatewayRateLimit;
  const maxMessages =
    Number.isFinite(candidate.maxMessages) && candidate.maxMessages > 0
      ? candidate.maxMessages
      : defaultGatewayRateLimit.maxMessages;
  const maxCommandMessages =
    Number.isFinite(candidate.maxCommandMessages) &&
    candidate.maxCommandMessages > 0 &&
    candidate.maxCommandMessages <= maxMessages
      ? candidate.maxCommandMessages
      : Math.min(defaultGatewayRateLimit.maxCommandMessages, maxMessages);
  const maxPayloadBytes =
    Number.isFinite(candidate.maxPayloadBytes) && candidate.maxPayloadBytes > 0
      ? candidate.maxPayloadBytes
      : defaultGatewayRateLimit.maxPayloadBytes;
  const windowMs =
    Number.isFinite(candidate.windowMs) && candidate.windowMs > 0
      ? candidate.windowMs
      : defaultGatewayRateLimit.windowMs;

  return {
    maxCommandMessages,
    maxMessages,
    maxPayloadBytes,
    windowMs,
  };
};

const getDeviceIdFromRequest = (requestUrl: string | undefined): string => {
  if (requestUrl === undefined) {
    return config.defaultDeviceId;
  }

  const parsedUrl = new URL(requestUrl, 'http://localhost');
  const deviceId = parsedUrl.searchParams.get('deviceId')?.trim();
  return deviceId !== undefined && deviceId !== '' ? deviceId : config.defaultDeviceId;
};

const sendJson = (ws: WebSocket, message: Record<string, unknown>): void => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const sendPacket = (ws: WebSocket, packet: TransportPacket): void => {
  sendJson(ws, packet as unknown as Record<string, unknown>);
};

const parsePayload = (payload: string): unknown => {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
};

const normalizeOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const unwrapEnvelopePayload = (value: unknown): unknown => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'payload' in value &&
    (value as { payload?: unknown }).payload !== undefined
  ) {
    return (value as { payload?: unknown }).payload;
  }

  return value;
};

const buildEnvelope = (
  type: string,
  payload: unknown,
  overrides?: { msgId?: string; timestamp?: string },
): TransportEnvelope => ({
  msgId: normalizeOptionalString(overrides?.msgId) ?? crypto.randomUUID(),
  payload,
  timestamp: normalizeOptionalString(overrides?.timestamp) ?? new Date().toISOString(),
  type,
});

const requestDeviceStatus = (
  publishMessage: WebSocketDependencies['publishMqtt'],
  deviceId: string,
): void => {
  publishMessage(deviceId, 'command', JSON.stringify(buildEnvelope('get-status', {})));
};

const getInboundRateLimiter = (ws: WebSocket) => {
  let limiter = inboundRateLimits.get(ws);
  if (limiter !== undefined) {
    return limiter;
  }

  limiter = {
    commandTimestamps: [],
    messageTimestamps: [],
  };
  inboundRateLimits.set(ws, limiter);
  return limiter;
};

const pruneExpiredTimestamps = (timestamps: number[], cutoffMs: number): number[] => {
  let firstActiveIndex = 0;
  while (firstActiveIndex < timestamps.length && timestamps[firstActiveIndex] < cutoffMs) {
    firstActiveIndex += 1;
  }

  if (firstActiveIndex === 0) {
    return timestamps;
  }
  if (firstActiveIndex >= timestamps.length) {
    return [];
  }
  return timestamps.slice(firstActiveIndex);
};

const recordInboundMessage = (
  limiter: { commandTimestamps: number[]; messageTimestamps: number[] },
  nowMs: number,
  rateLimit: GatewayWebSocketRateLimit,
): string | null => {
  limiter.messageTimestamps = pruneExpiredTimestamps(
    limiter.messageTimestamps,
    nowMs - rateLimit.windowMs,
  );
  if (limiter.messageTimestamps.length >= rateLimit.maxMessages) {
    return 'too many websocket messages';
  }

  limiter.messageTimestamps.push(nowMs);
  return null;
};

const recordInboundCommand = (
  limiter: { commandTimestamps: number[]; messageTimestamps: number[] },
  nowMs: number,
  rateLimit: GatewayWebSocketRateLimit,
): string | null => {
  limiter.commandTimestamps = pruneExpiredTimestamps(
    limiter.commandTimestamps,
    nowMs - rateLimit.windowMs,
  );
  if (limiter.commandTimestamps.length >= rateLimit.maxCommandMessages) {
    return 'too many websocket commands';
  }

  limiter.commandTimestamps.push(nowMs);
  return null;
};

const readRoutingIds = (
  value: unknown,
): {
  requestId: string | null;
  sessionId: string | null;
} => {
  const payload = unwrapEnvelopePayload(value);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { requestId: null, sessionId: null };
  }

  return {
    requestId: normalizeOptionalString((payload as Record<string, unknown>)['requestId']),
    sessionId: normalizeOptionalString((payload as Record<string, unknown>)['sessionId']),
  };
};

const readEnvelopeField = (value: unknown, field: string): string | null => {
  const payload = unwrapEnvelopePayload(value);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  return normalizeOptionalString((payload as Record<string, unknown>)[field]);
};

const isTransportEnvelope = (value: unknown): value is TransportEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { type?: unknown }).type === 'string' &&
  ((value as { type?: string }).type?.trim() ?? '') !== '';

const isPacketFrame = (value: unknown): value is PacketFrame => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const frame = value as Partial<PacketFrame>;
  return (
    frame.kind === 'packet' &&
    typeof frame.subtopic === 'string' &&
    frame.subtopic.trim() !== '' &&
    isTransportEnvelope(frame.envelope)
  );
};

const isSetDeviceFrame = (value: unknown): value is SetDeviceFrame =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { kind?: unknown }).kind === 'set-device';

const createPacket = (
  deviceId: string,
  service: string | null,
  subtopic: string,
  envelope: TransportEnvelope,
): TransportPacket => ({
  deviceId,
  envelope,
  service,
  subtopic,
});

const normalizeIncomingEnvelope = (envelope: TransportEnvelope): TransportEnvelope =>
  buildEnvelope(envelope.type.trim(), envelope.payload ?? {}, {
    msgId: envelope.msgId,
    timestamp: envelope.timestamp,
  });

const registerRequestOwner = (ws: WebSocket, requestId: string): void => {
  requestOwners.set(requestId, ws);

  const requests = clientRequests.get(ws) ?? new Set<string>();
  requests.add(requestId);
  clientRequests.set(ws, requests);
};

const bindSessionOwner = (ws: WebSocket, sessionId: string): void => {
  sessionOwners.set(sessionId, ws);

  const sessions = clientSessions.get(ws) ?? new Set<string>();
  sessions.add(sessionId);
  clientSessions.set(ws, sessions);
};

const clearClientRoutes = (ws: WebSocket): void => {
  const requests = clientRequests.get(ws);
  if (requests !== undefined) {
    for (const requestId of requests) {
      requestOwners.delete(requestId);
    }
    clientRequests.delete(ws);
  }

  const sessions = clientSessions.get(ws);
  if (sessions !== undefined) {
    for (const sessionId of sessions) {
      sessionOwners.delete(sessionId);
    }
    clientSessions.delete(ws);
  }
};

const cleanupClient = (ws: WebSocket, deps: WebSocketDependencies): void => {
  const context = clients.get(ws);
  if (context !== undefined) {
    deps.unsubscribeFromDevice(context.deviceId);
  }

  clearClientRoutes(ws);
  clients.delete(ws);
  inboundRateLimits.delete(ws);
};

export const resetWebSocketStateForTests = (): void => {
  clients.clear();
  requestOwners.clear();
  sessionOwners.clear();
  clientRequests.clear();
  clientSessions.clear();
  lastKnownStatuses.clear();
  inboundRateLimits.clear();
};

const packetTargets = (packet: TransportPacket): Set<WebSocket> | null => {
  const { requestId, sessionId } = readRoutingIds(packet.envelope);
  if (requestId !== null) {
    const owner = requestOwners.get(requestId);
    if (owner !== undefined) {
      if (sessionId !== null) {
        bindSessionOwner(owner, sessionId);
      }
      return new Set([owner]);
    }
  }

  if (sessionId !== null) {
    const owner = sessionOwners.get(sessionId);
    if (owner !== undefined) {
      return new Set([owner]);
    }
  }

  return null;
};

const clientOwnsSession = (ws: WebSocket, sessionId: string | null): boolean => {
  if (sessionId === null) {
    return true;
  }

  const owner = sessionOwners.get(sessionId);
  return owner === undefined || owner === ws;
};

const sendGatewayError = (
  ws: WebSocket,
  deviceId: string,
  message: string,
  options?: {
    requestType?: string;
    service?: string | null;
    subtopic?: string;
  },
): void => {
  sendPacket(
    ws,
    createPacket(
      deviceId,
      options?.service ?? null,
      options?.subtopic ?? 'response',
      buildEnvelope('service-unavailable', {
        error: message,
        requestType: options?.requestType ?? undefined,
        service: options?.service ?? null,
        subtopic: options?.subtopic ?? null,
      }),
    ),
  );
};

const inboundMessageCountsAsCommand = (message: InboundFrame): boolean =>
  isSetDeviceFrame(message) || (isPacketFrame(message) && message.subtopic.trim() === 'command');

const closeForRateLimit = (ws: WebSocket, deps: WebSocketDependencies, reason: string): void => {
  deps.warn(`closing websocket for rate limit violation: ${reason}`);
  cleanupClient(ws, deps);
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close(1008, reason);
  }
};

const sendSessionInfo = (ws: WebSocket, deviceId: string): void => {
  sendJson(ws, {
    deviceId,
    kind: 'session-info',
  });
};

const syncClientDevice = async (
  ws: WebSocket,
  deviceId: string,
  deps: WebSocketDependencies,
): Promise<void> => {
  const nextDeviceId = deviceId.trim() !== '' ? deviceId.trim() : config.defaultDeviceId;
  const context = clients.get(ws);
  if (context === undefined) {
    return;
  }

  if (context.deviceId !== nextDeviceId) {
    await deps.subscribeToDevice(nextDeviceId);
    clearClientRoutes(ws);
    deps.unsubscribeFromDevice(context.deviceId);
    clients.set(ws, { deviceId: nextDeviceId });
  }

  sendSessionInfo(ws, nextDeviceId);

  const cachedStatus = lastKnownStatuses.get(nextDeviceId);
  if (cachedStatus !== undefined) {
    sendPacket(ws, cachedStatus);
  }

  requestDeviceStatus(deps.publishMqtt, nextDeviceId);
};

export function setupWebSocket(
  server: Server,
  options: WebSocketSetupOptions = {},
): WebSocketServer {
  const deps: WebSocketDependencies = {
    ...defaultWebSocketDependencies,
    ...options.deps,
  };
  const rateLimit = normalizeGatewayRateLimit(options.rateLimit ?? config.wsRateLimit);
  const wss = new WebSocketServer({
    maxPayload: rateLimit.maxPayloadBytes,
    path: '/ws',
    server,
  });

  deps.onMqttMessage((topic, payload) => {
    const parsedTopic = deps.parseDeviceTopic(topic);
    if (parsedTopic === null) {
      return;
    }

    const parsedPayload = parsePayload(payload);
    if (!isTransportEnvelope(parsedPayload)) {
      return;
    }

    if (
      parsedTopic.subtopic === 'webrtc/ice' &&
      readEnvelopeField(parsedPayload, 'origin') === 'browser'
    ) {
      return;
    }

    const packet = createPacket(
      parsedTopic.deviceId,
      parsedTopic.service,
      parsedTopic.subtopic,
      parsedPayload,
    );

    if (
      packet.service === null &&
      (packet.subtopic === 'status' ||
        (packet.subtopic === 'response' && packet.envelope.type === 'status'))
    ) {
      lastKnownStatuses.set(parsedTopic.deviceId, packet);
    }

    const targetedClients = packetTargets(packet);
    for (const [ws, context] of clients.entries()) {
      if (context.deviceId !== parsedTopic.deviceId) {
        continue;
      }
      if (targetedClients !== null && !targetedClients.has(ws)) {
        continue;
      }
      sendPacket(ws, packet);
    }
  });

  wss.on('connection', async (ws, request) => {
    const deviceId = getDeviceIdFromRequest(request.url);
    clients.set(ws, { deviceId });

    try {
      await deps.subscribeToDevice(deviceId);
      sendSessionInfo(ws, deviceId);

      const cachedStatus = lastKnownStatuses.get(deviceId);
      if (cachedStatus !== undefined) {
        sendPacket(ws, cachedStatus);
      }

      requestDeviceStatus(deps.publishMqtt, deviceId);
    } catch (error) {
      sendGatewayError(ws, deviceId, error instanceof Error ? error.message : 'subscribe failed', {
        requestType: 'set-device',
      });
    }

    ws.on('message', (data) => {
      const limiter = getInboundRateLimiter(ws);
      const nowMs = deps.now();
      const messageViolation = recordInboundMessage(limiter, nowMs, rateLimit);
      if (messageViolation !== null) {
        closeForRateLimit(ws, deps, messageViolation);
        return;
      }

      let message: InboundFrame;
      try {
        message = JSON.parse(data.toString()) as InboundFrame;
      } catch {
        return;
      }

      const context = clients.get(ws);
      if (context === undefined) {
        return;
      }

      if (inboundMessageCountsAsCommand(message)) {
        const commandViolation = recordInboundCommand(limiter, nowMs, rateLimit);
        if (commandViolation !== null) {
          closeForRateLimit(ws, deps, commandViolation);
          return;
        }
      }

      if (isSetDeviceFrame(message)) {
        const nextDeviceId = normalizeOptionalString(message.deviceId) ?? config.defaultDeviceId;
        void syncClientDevice(ws, nextDeviceId, deps).catch((error) => {
          sendGatewayError(
            ws,
            context.deviceId,
            error instanceof Error ? error.message : 'subscribe failed',
            { requestType: 'set-device' },
          );
        });
        return;
      }

      if (!isPacketFrame(message)) {
        sendGatewayError(ws, context.deviceId, 'invalid transport packet frame');
        return;
      }

      const sessionId = readRoutingIds(message.envelope).sessionId;
      if (!clientOwnsSession(ws, sessionId)) {
        return;
      }

      const normalizedPacket = createPacket(
        context.deviceId,
        normalizeOptionalString(message.service),
        message.subtopic.trim(),
        normalizeIncomingEnvelope(message.envelope),
      );
      const requestId = readRoutingIds(normalizedPacket.envelope).requestId;
      if (requestId !== null) {
        registerRequestOwner(ws, requestId);
      }

      deps.publishMqtt(
        context.deviceId,
        normalizedPacket.subtopic,
        JSON.stringify(normalizedPacket.envelope),
        normalizedPacket.service,
      );
    });

    ws.on('close', () => {
      cleanupClient(ws, deps);
    });

    ws.on('error', () => {
      cleanupClient(ws, deps);
    });
  });

  console.log('[ws] WebSocket server attached on /ws');
  return wss;
}
