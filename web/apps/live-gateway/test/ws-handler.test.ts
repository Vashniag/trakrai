import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { WebSocket } from 'ws';

import {
  resetWebSocketStateForTests,
  setupWebSocket,
  type WebSocketSetupOptions,
} from '../src/ws-handler.js';

const closeTestServer = async (server: Server): Promise<void> =>
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

test('setupWebSocket closes clients that exceed the inbound command rate limit', async (t) => {
  resetWebSocketStateForTests();

  const publishCalls: Array<{
    deviceId: string;
    payload: string;
    service?: string | null;
    subtopic: string;
  }> = [];
  const warnings: string[] = [];

  const server = createServer((_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });

  const options: WebSocketSetupOptions = {
    deps: {
      onMqttMessage: () => {},
      publishMqtt: (deviceId, subtopic, payload, service) => {
        publishCalls.push({ deviceId, payload, service, subtopic });
      },
      subscribeToDevice: async () => {},
      unsubscribeFromDevice: () => {},
      warn: (message) => {
        warnings.push(message);
      },
    },
    rateLimit: {
      maxCommandMessages: 2,
      maxMessages: 10,
      maxPayloadBytes: 1024 * 1024,
      windowMs: 1000,
    },
  };

  const wss = setupWebSocket(server, options);

  t.after(async () => {
    resetWebSocketStateForTests();
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    await closeTestServer(server);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');

  const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws?deviceId=edge-device-1`);
  const sessionInfoPromise = once(client, 'message');
  await once(client, 'open');

  const [sessionInfoRaw] = await sessionInfoPromise;
  const sessionInfo = JSON.parse(sessionInfoRaw.toString()) as {
    deviceId: string;
    kind: string;
  };
  assert.equal(sessionInfo.kind, 'session-info');
  assert.equal(sessionInfo.deviceId, 'edge-device-1');

  const packet = JSON.stringify({
    envelope: {
      payload: {
        requestId: 'req-1',
      },
      type: 'get-status',
    },
    kind: 'packet',
    service: 'runtime-manager',
    subtopic: 'command',
  });

  const closeEventPromise = Promise.race([
    once(client, 'close'),
    delay(2000).then(() => {
      throw new Error('timed out waiting for websocket close');
    }),
  ]);

  client.send(packet);
  client.send(packet);
  client.send(packet);

  const [closeCode, closeReason] = (await closeEventPromise) as [number, Buffer];

  assert.equal(closeCode, 1008);
  assert.equal(closeReason.toString(), 'too many websocket commands');
  assert.equal(publishCalls.length, 3);
  assert.equal(publishCalls[0]?.subtopic, 'command');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /too many websocket commands/);
});
