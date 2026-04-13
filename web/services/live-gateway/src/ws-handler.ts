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

const clients = new Map<WebSocket, ClientContext>();

const getDeviceIdFromRequest = (requestUrl: string | undefined): string => {
  if (requestUrl === undefined) {
    return config.defaultDeviceId;
  }

  const parsedUrl = new URL(requestUrl, 'http://localhost');
  return parsedUrl.searchParams.get('deviceId') ?? config.defaultDeviceId;
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

const buildEnvelope = (type: string, payload: unknown): string =>
  JSON.stringify({
    msgId: crypto.randomUUID(),
    payload,
    timestamp: new Date().toISOString(),
    type,
  });

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  onMqttMessage((topic, payload) => {
    const parsedTopic = parseDeviceTopic(topic);
    if (parsedTopic === null) {
      return;
    }

    const topicTypeToWsType: Partial<Record<typeof parsedTopic.topicType, string>> = {
      response: 'device-response',
      status: 'device-status',
      webrtcIce: 'ice-candidate',
      webrtcOffer: 'sdp-offer',
    };
    const wsType = topicTypeToWsType[parsedTopic.topicType];

    if (wsType === undefined) {
      return;
    }

    const message = {
      deviceId: parsedTopic.deviceId,
      payload: parsePayload(payload),
      type: wsType,
    };

    for (const [ws, clientContext] of clients.entries()) {
      if (clientContext.deviceId === parsedTopic.deviceId) {
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
        return;
      }

      switch (message.type) {
        case 'get-status':
        case 'start-live':
        case 'stop-live':
          publishMqtt(
            clientContext.deviceId,
            'command',
            buildEnvelope(message.type, message.payload ?? {}),
          );
          break;
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
        default:
          break;
      }
    });

    ws.on('close', () => {
      const clientContext = clients.get(ws);
      if (clientContext !== undefined) {
        unsubscribeFromDevice(clientContext.deviceId);
      }
      clients.delete(ws);
    });

    ws.on('error', () => {
      const clientContext = clients.get(ws);
      if (clientContext !== undefined) {
        unsubscribeFromDevice(clientContext.deviceId);
      }
      clients.delete(ws);
    });
  });

  console.log('[ws] WebSocket server attached on /ws');
}
