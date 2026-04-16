import express from 'express';
import { createServer } from 'http';
import { config, serviceName } from './config.js';
import { connectMqtt, getMqttClient } from './mqtt-client.js';
import { setupWebSocket } from './ws-handler.js';

const app = express();

// CORS middleware
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', config.corsOrigin);
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ICE/TURN configuration endpoint for browser WebRTC setup
app.get('/api/ice-config', (_req, res) => {
  const iceServers = [{ urls: config.stunServerUrl }] as Array<
    | { urls: string }
    | {
        credential: string;
        urls: string;
        username: string;
      }
  >;

  if (config.turn !== null) {
    iceServers.push({
      urls: config.turn.url,
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
      console.log(`[${serviceName}] TURN relay: ${config.turn.url}`);
    }
  });
}

main().catch((err) => {
  console.error(`[${serviceName}] fatal:`, err);
  process.exit(1);
});
