import express from 'express';
import { createServer } from 'http';

import { verifyDeviceGatewayAccessToken } from '@trakrai/backend/lib/gateway-access-token';

import { config, serviceName } from './config.js';
import { connectMqtt, getMqttClient } from './mqtt-client.js';
import { setupWebSocket } from './ws-handler.js';

const app = express();
const BEARER_PREFIX = 'Bearer ';

const readGatewayAccessToken = (request: express.Request): string | null => {
  const authorizationHeader = request.header('authorization') ?? request.header('Authorization');
  if (authorizationHeader?.startsWith(BEARER_PREFIX) === true) {
    const bearerToken = authorizationHeader.slice(BEARER_PREFIX.length).trim();
    if (bearerToken !== '') {
      return bearerToken;
    }
  }

  const queryToken =
    typeof request.query.gatewayAccessToken === 'string'
      ? request.query.gatewayAccessToken.trim()
      : '';
  return queryToken !== '' ? queryToken : null;
};

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ICE/TURN configuration endpoint for browser WebRTC setup
app.get('/api/ice-config', async (req, res) => {
  const gatewayAccessToken = readGatewayAccessToken(req);
  if (gatewayAccessToken === null) {
    res.status(401).json({ error: 'Missing gateway access token.' });
    return;
  }

  try {
    await verifyDeviceGatewayAccessToken(gatewayAccessToken);
  } catch {
    res.status(401).json({ error: 'Invalid gateway access token.' });
    return;
  }

  const iceServers = [{ urls: config.stunServerUrl }] as Array<
    | { urls: string | string[] }
    | {
        credential: string;
        urls: string | string[];
        username: string;
      }
  >;

  if (config.turn !== null) {
    iceServers.push({
      urls: config.turn.urls,
      username: config.turn.username,
      credential: config.turn.credential,
    });
  }

  res.json({
    iceServers,
  });
});

// Health check
app.get('/api/health', (_req, res) => {
  const mqttClient = getMqttClient();
  res.json({
    status: 'ok',
    service: serviceName,
    mqtt: mqttClient?.connected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

async function main() {
  // Connect to MQTT broker
  await connectMqtt();

  // Create HTTP server and attach WebSocket
  const server = createServer(app);
  setupWebSocket(server);

  server.listen(config.port, () => {
    console.log(`[${serviceName}] HTTP + WS listening on :${config.port}`);
    console.log(`[${serviceName}] ICE config endpoint: /api/ice-config`);
    console.log(`[${serviceName}] WebSocket endpoint: /ws`);
    console.log(`[${serviceName}] default device: ${config.defaultDeviceId}`);
    console.log(`[${serviceName}] STUN server: ${config.stunServerUrl}`);
    if (config.turn === null) {
      console.warn(
        `[${serviceName}] TURN relay is disabled; browser ICE config will advertise STUN only.`,
      );
    } else {
      console.log(`[${serviceName}] TURN relay: ${config.turn.urls.join(', ')}`);
    }
  });
}

main().catch((err) => {
  console.error(`[${serviceName}] fatal:`, err);
  process.exit(1);
});
