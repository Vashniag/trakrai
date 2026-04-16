import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    DEVICE_ID: z.string().default('default'),
    MQTT_BROKER_URL: z.string().default('mqtt://localhost:1883'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    STUN_SERVER_URL: z.string().default('stun:stun.l.google.com:19302'),
    TURN_CREDENTIAL: z.string().default('trakrai-secret'),
    TURN_SERVER_URL: z.string().optional(),
    TURN_USERNAME: z.string().default('trakrai'),
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
