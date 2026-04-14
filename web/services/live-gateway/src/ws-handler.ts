import type { Server } from 'http';

import { WebSocketServer, WebSocket } from 'ws';

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

type WsInboundMessage = {
  payload?: unknown;
  type: string;
};

type MessageEnvelope = {
  payload?: unknown;
  type?: string;
};

const PTZ_SERVICE_NAME = 'ptz-control';

const clients = new Map<WebSocket, ClientContext>();
const liveRequestOwners = new Map<string, WebSocket>();
const liveSessionOwners = new Map<string, WebSocket>();
const liveRequestsByClient = new Map<WebSocket, Set<string>>();
const liveSessionsByClient = new Map<WebSocket, Set<string>>();
const lastKnownStatuses = new Map<string, unknown>();

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

const parsePayload = (payload: string): unknown => {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
};

const getEnvelopeType = (payload: unknown): string | null => {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'type' in payload &&
    typeof (payload as MessageEnvelope).type === 'string'
  ) {
    return (payload as MessageEnvelope).type ?? null;
  }

  return null;
};

const buildEnvelope = (type: string, payload: unknown): string =>
  JSON.stringify({
    msgId: crypto.randomUUID(),
    payload,
    timestamp: new Date().toISOString(),
    type,
  });

const requestDeviceStatus = (deviceId: string): void => {
  publishMqtt(deviceId, 'command', buildEnvelope('get-status', {}));
};

const requestPtzStatus = (deviceId: string): void => {
  publishMqtt(deviceId, 'command', buildEnvelope('get-status', {}), PTZ_SERVICE_NAME);
};

const normalizeOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const unwrapEnvelopePayload = (payload: unknown): unknown => {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'payload' in payload &&
    (payload as MessageEnvelope).payload !== undefined
  ) {
    return (payload as MessageEnvelope).payload;
  }

  return payload;
};

const getMutablePayload = (payload: unknown): Record<string, unknown> => {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>) };
  }

  return {};
};

const getLiveRoutingIds = (
  payload: unknown,
): { requestId: string | null; sessionId: string | null } => {
  const messagePayload = unwrapEnvelopePayload(payload);
  if (
    typeof messagePayload !== 'object' ||
    messagePayload === null ||
    Array.isArray(messagePayload)
  ) {
    return { requestId: null, sessionId: null };
  }

  return {
    requestId: normalizeOptionalString((messagePayload as Record<string, unknown>)['requestId']),
    sessionId: normalizeOptionalString((messagePayload as Record<string, unknown>)['sessionId']),
  };
};

const registerLiveRequestOwner = (ws: WebSocket, requestId: string): void => {
  liveRequestOwners.set(requestId, ws);

  const requestsForClient = liveRequestsByClient.get(ws) ?? new Set<string>();
  requestsForClient.add(requestId);
  liveRequestsByClient.set(ws, requestsForClient);
};

const bindLiveSessionOwner = (ws: WebSocket, sessionId: string): void => {
  liveSessionOwners.set(sessionId, ws);

  const sessionsForClient = liveSessionsByClient.get(ws) ?? new Set<string>();
  sessionsForClient.add(sessionId);
  liveSessionsByClient.set(ws, sessionsForClient);
};

const unregisterLiveSessionOwner = (sessionId: string): void => {
  const owner = liveSessionOwners.get(sessionId);
  if (owner !== undefined) {
    liveSessionsByClient.get(owner)?.delete(sessionId);
  }
  liveSessionOwners.delete(sessionId);
};

const clearClientLiveRoutes = (ws: WebSocket): void => {
  const requestIds = liveRequestsByClient.get(ws);
  if (requestIds !== undefined) {
    for (const requestId of requestIds) {
      liveRequestOwners.delete(requestId);
    }
    liveRequestsByClient.delete(ws);
  }

  const sessionIds = liveSessionsByClient.get(ws);
  if (sessionIds !== undefined) {
    for (const sessionId of sessionIds) {
      liveSessionOwners.delete(sessionId);
    }
    liveSessionsByClient.delete(ws);
  }
};

const stopClientLiveSessions = (ws: WebSocket, deviceId: string): void => {
  const sessionIds = Array.from(liveSessionsByClient.get(ws) ?? []);
  for (const sessionId of sessionIds) {
    publishMqtt(deviceId, 'command', buildEnvelope('stop-live', { sessionId }));
  }
};

const cleanupClient = (ws: WebSocket): void => {
  const clientContext = clients.get(ws);
  if (clientContext !== undefined) {
    stopClientLiveSessions(ws, clientContext.deviceId);
    unsubscribeFromDevice(clientContext.deviceId);
  }
  clearClientLiveRoutes(ws);
  clients.delete(ws);
};

const ensureStartLivePayload = (payload: unknown): Record<string, unknown> => {
  const nextPayload = getMutablePayload(payload);
  if (normalizeOptionalString(nextPayload['requestId']) === null) {
    nextPayload['requestId'] = crypto.randomUUID();
  }

  return nextPayload;
};

const getLiveMessageTargets = (wsType: string, parsedPayload: unknown): Set<WebSocket> | null => {
  if (wsType !== 'device-response' && wsType !== 'sdp-offer' && wsType !== 'ice-candidate') {
    return null;
  }

  const envelopeType = getEnvelopeType(parsedPayload);
  const { requestId, sessionId } = getLiveRoutingIds(parsedPayload);

  if (requestId !== null) {
    const owner = liveRequestOwners.get(requestId);
    if (owner !== undefined) {
      if (sessionId !== null) {
        bindLiveSessionOwner(owner, sessionId);
      }
      return new Set([owner]);
    }
  }

  if (sessionId !== null) {
    const owner = liveSessionOwners.get(sessionId);
    if (owner !== undefined) {
      return new Set([owner]);
    }
  }

  if (wsType === 'device-response' && envelopeType === 'service-unavailable') {
    return null;
  }

  return null;
};

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  onMqttMessage((topic, payload) => {
    const parsedTopic = parseDeviceTopic(topic);
    if (parsedTopic === null) {
      return;
    }

    const parsedPayload = parsePayload(payload);
    const envelopeType = getEnvelopeType(parsedPayload);
    const isBaseTopic = parsedTopic.service === null;
    const isStatusResponse =
      isBaseTopic && parsedTopic.topicType === 'response' && envelopeType === 'status';

    let wsType: string | undefined;
    if (parsedTopic.service === PTZ_SERVICE_NAME) {
      if (parsedTopic.topicType === 'response') {
        wsType = 'ptz-response';
      } else if (parsedTopic.topicType === 'status') {
        wsType = 'ptz-status';
      }
    } else {
      const topicTypeToWsType: Partial<Record<typeof parsedTopic.topicType, string>> = {
        response: isStatusResponse ? 'device-status' : 'device-response',
        status: 'device-status',
        webrtcIce: 'ice-candidate',
        webrtcOffer: 'sdp-offer',
      };
      wsType = topicTypeToWsType[parsedTopic.topicType];
    }

    if (wsType === undefined) {
      return;
    }
    if ((parsedTopic.topicType === 'status' && isBaseTopic) || isStatusResponse) {
      lastKnownStatuses.set(parsedTopic.deviceId, parsedPayload);
    }

    const message = {
      deviceId: parsedTopic.deviceId,
      payload: parsedPayload,
      service: parsedTopic.service,
      type: wsType,
    };

    const targetedClients = getLiveMessageTargets(wsType, parsedPayload);
    for (const [ws, clientContext] of clients.entries()) {
      if (clientContext.deviceId === parsedTopic.deviceId) {
        if (targetedClients !== null && !targetedClients.has(ws)) {
          continue;
        }
        sendJson(ws, message);
      }
    }
  });

  wss.on('connection', async (ws, request) => {
    const deviceId = getDeviceIdFromRequest(request.url);
    clients.set(ws, { deviceId });

    try {
      await subscribeToDevice(deviceId);
      sendJson(ws, { deviceId, type: 'session-info' });
      const cachedStatus = lastKnownStatuses.get(deviceId);
      if (cachedStatus !== undefined) {
        sendJson(ws, {
          deviceId,
          payload: cachedStatus,
          type: 'device-status',
        });
      }
      requestDeviceStatus(deviceId);
      requestPtzStatus(deviceId);
    } catch (error) {
      sendJson(ws, {
        deviceId,
        payload: { error: error instanceof Error ? error.message : 'subscribe failed' },
        type: 'device-response',
      });
    }

    ws.on('message', (data) => {
      let message: WsInboundMessage;
      try {
        message = JSON.parse(data.toString()) as WsInboundMessage;
      } catch {
        return;
      }

      const clientContext = clients.get(ws);
      if (clientContext === undefined) {
        return;
      }

      if (message.type === 'set-device') {
        const nextDeviceId =
          typeof message.payload === 'object' &&
          message.payload !== null &&
          'deviceId' in message.payload &&
          typeof message.payload.deviceId === 'string'
            ? message.payload.deviceId
            : config.defaultDeviceId;

        if (nextDeviceId !== clientContext.deviceId) {
          stopClientLiveSessions(ws, clientContext.deviceId);
          clearClientLiveRoutes(ws);
          unsubscribeFromDevice(clientContext.deviceId);
          void subscribeToDevice(nextDeviceId).catch((error) => {
            sendJson(ws, {
              deviceId: nextDeviceId,
              payload: { error: error instanceof Error ? error.message : 'subscribe failed' },
              type: 'device-response',
            });
          });
          clients.set(ws, { deviceId: nextDeviceId });
        }

        sendJson(ws, { deviceId: nextDeviceId, type: 'session-info' });
        const cachedStatus = lastKnownStatuses.get(nextDeviceId);
        if (cachedStatus !== undefined) {
          sendJson(ws, {
            deviceId: nextDeviceId,
            payload: cachedStatus,
            type: 'device-status',
          });
        }
        requestDeviceStatus(nextDeviceId);
        requestPtzStatus(nextDeviceId);
        return;
      }

      switch (message.type) {
        case 'get-status':
          publishMqtt(
            clientContext.deviceId,
            'command',
            buildEnvelope(message.type, message.payload ?? {}),
          );
          break;
        case 'start-live': {
          const payload = ensureStartLivePayload(message.payload);
          const requestId = normalizeOptionalString(payload['requestId']);
          if (requestId !== null) {
            registerLiveRequestOwner(ws, requestId);
          }
          publishMqtt(clientContext.deviceId, 'command', buildEnvelope(message.type, payload));
          break;
        }
        case 'update-live-layout':
          publishMqtt(
            clientContext.deviceId,
            'command',
            buildEnvelope(message.type, message.payload ?? {}),
          );
          break;
        case 'stop-live': {
          const payload = getMutablePayload(message.payload);
          const sessionId = normalizeOptionalString(payload['sessionId']);
          if (sessionId !== null) {
            unregisterLiveSessionOwner(sessionId);
          } else {
            clearClientLiveRoutes(ws);
          }
          publishMqtt(clientContext.deviceId, 'command', buildEnvelope(message.type, payload));
          break;
        }
        case 'sdp-answer':
          publishMqtt(
            clientContext.deviceId,
            'webrtcAnswer',
            buildEnvelope('sdp-answer', message.payload),
          );
          break;
        case 'ice-candidate':
          publishMqtt(
            clientContext.deviceId,
            'webrtcIce',
            buildEnvelope('ice-candidate', message.payload),
          );
          break;
        case 'ptz-get-status':
          publishMqtt(
            clientContext.deviceId,
            'command',
            buildEnvelope('get-status', message.payload ?? {}),
            PTZ_SERVICE_NAME,
          );
          break;
        case 'ptz-get-position':
          publishMqtt(
            clientContext.deviceId,
            'command',
            buildEnvelope('get-position', message.payload ?? {}),
            PTZ_SERVICE_NAME,
          );
          break;
        case 'ptz-start-move':
          publishMqtt(
            clientContext.deviceId,
            'command',
            buildEnvelope('start-move', message.payload ?? {}),
            PTZ_SERVICE_NAME,
          );
          break;
        case 'ptz-stop':
          publishMqtt(
            clientContext.deviceId,
            'command',
            buildEnvelope('stop-move', message.payload ?? {}),
            PTZ_SERVICE_NAME,
          );
          break;
        case 'ptz-set-zoom':
          publishMqtt(
            clientContext.deviceId,
            'command',
            buildEnvelope('set-zoom', message.payload ?? {}),
            PTZ_SERVICE_NAME,
          );
          break;
        case 'ptz-go-home':
          publishMqtt(
            clientContext.deviceId,
            'command',
            buildEnvelope('go-home', message.payload ?? {}),
            PTZ_SERVICE_NAME,
          );
          break;
        default:
          break;
      }
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
