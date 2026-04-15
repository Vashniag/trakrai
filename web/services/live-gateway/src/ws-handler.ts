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

const requestDeviceStatus = (deviceId: string): void => {
  publishMqtt(deviceId, 'command', JSON.stringify(buildEnvelope('get-status', {})));
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

const cleanupClient = (ws: WebSocket): void => {
  const context = clients.get(ws);
  if (context !== undefined) {
    unsubscribeFromDevice(context.deviceId);
  }

  clearClientRoutes(ws);
  clients.delete(ws);
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

const sendSessionInfo = (ws: WebSocket, deviceId: string): void => {
  sendJson(ws, {
    deviceId,
    kind: 'session-info',
  });
};

const syncClientDevice = async (ws: WebSocket, deviceId: string): Promise<void> => {
  const nextDeviceId = deviceId.trim() !== '' ? deviceId.trim() : config.defaultDeviceId;
  const context = clients.get(ws);
  if (context === undefined) {
    return;
  }

  if (context.deviceId !== nextDeviceId) {
    await subscribeToDevice(nextDeviceId);
    clearClientRoutes(ws);
    unsubscribeFromDevice(context.deviceId);
    clients.set(ws, { deviceId: nextDeviceId });
  }

  sendSessionInfo(ws, nextDeviceId);

  const cachedStatus = lastKnownStatuses.get(nextDeviceId);
  if (cachedStatus !== undefined) {
    sendPacket(ws, cachedStatus);
  }

  requestDeviceStatus(nextDeviceId);
};

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  onMqttMessage((topic, payload) => {
    const parsedTopic = parseDeviceTopic(topic);
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
      await subscribeToDevice(deviceId);
      sendSessionInfo(ws, deviceId);

      const cachedStatus = lastKnownStatuses.get(deviceId);
      if (cachedStatus !== undefined) {
        sendPacket(ws, cachedStatus);
      }

      requestDeviceStatus(deviceId);
    } catch (error) {
      sendGatewayError(ws, deviceId, error instanceof Error ? error.message : 'subscribe failed', {
        requestType: 'set-device',
      });
    }

    ws.on('message', (data) => {
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

      if (isSetDeviceFrame(message)) {
        const nextDeviceId = normalizeOptionalString(message.deviceId) ?? config.defaultDeviceId;
        void syncClientDevice(ws, nextDeviceId).catch((error) => {
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

      publishMqtt(
        context.deviceId,
        normalizedPacket.subtopic,
        JSON.stringify(normalizedPacket.envelope),
        normalizedPacket.service,
      );
    });

    ws.on('close', () => {
      cleanupClient(ws);
    });

    ws.on('error', () => {
      cleanupClient(ws);
    });
  });

  console.log('[ws] WebSocket server attached on /ws');
}
