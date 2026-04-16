import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    // Default device id used only when a client does not explicitly select one.
    // Local source: shell env for convenience during development.
    DEVICE_ID: z.string().default('default'),

    // MQTT broker URL used to bridge browser requests to the device topics.
    // Local source: the local Mosquitto instance on the dev machine.
    // Deployment source: the broker URL used by the cloud stack.
    MQTT_BROKER_URL: z.string().default('mqtt://localhost:1883'),

    // Standard Node environment mode for this service process.
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // HTTP listen port for the live-gateway service.
    // Local source: shell env for `pnpm dev`; deployment source: container/service env.
    PORT: z.coerce.number().int().positive().default(4000),

    // STUN server advertised to browsers for ICE gathering.
    // Get this from your deployed STUN/TURN setup, or keep the public dev default.
    STUN_SERVER_URL: z.string().default('stun:stun.l.google.com:19302'),

    // TURN relay credentials advertised to browsers when `TURN_SERVER_URL` is set.
    // Get these from the coturn deployment or relay service you actually operate.
    TURN_CREDENTIAL: z.string().default('trakrai-secret'),
    TURN_SERVER_URL: z.string().optional(),
    TURN_USERNAME: z.string().default('trakrai'),

    // WebSocket payload/rate-limit guardrails for this service.
    // Tune only when the transport contract intentionally changes.
    WS_MAX_PAYLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(1024 * 1024),
    WS_RATE_LIMIT_MAX_COMMAND_MESSAGES: z.coerce.number().int().positive().default(40),
    WS_RATE_LIMIT_MAX_MESSAGES: z.coerce.number().int().positive().default(120),
    WS_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(5000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
