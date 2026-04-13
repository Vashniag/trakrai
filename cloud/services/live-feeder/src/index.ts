import { resolve } from 'path';
import express from 'express';
import { createServer } from 'http';
import { config } from './config.js';
import { connectMqtt, getMqttClient } from './mqtt-client.js';
import { setupWebSocket } from './ws-handler.js';

const app = express();

// CORS middleware
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Serve the live-view UI
app.get('/', (_req, res) => {
  res.sendFile(resolve('public', 'index.html'));
});

// ICE/TURN configuration endpoint for browser WebRTC setup
app.get('/api/ice-config', (_req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: config.turn.url,
        username: config.turn.username,
        credential: config.turn.credential,
      },
    ],
  });
});

// Health check
app.get('/api/health', (_req, res) => {
  const mqttClient = getMqttClient();
  res.json({
    status: 'ok',
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
    console.log(`[live-feeder] HTTP + WS listening on :${config.port}`);
    console.log(`[live-feeder] ICE config: GET http://localhost:${config.port}/api/ice-config`);
    console.log(`[live-feeder] WebSocket: ws://localhost:${config.port}/ws`);
    console.log(`[live-feeder] default device: ${config.defaultDeviceId}`);
  });
}

main().catch((err) => {
  console.error('[live-feeder] fatal:', err);
  process.exit(1);
});
