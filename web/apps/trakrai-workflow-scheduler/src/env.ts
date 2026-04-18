import { createEnv } from '@t3-oss/env-core';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const DEFAULT_REDIS_HOST = 'localhost';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_WEB_APP_BASE_URL = 'http://localhost:3000';
const DEFAULT_SCHEDULER_HOST = '0.0.0.0';
const DEFAULT_SCHEDULER_PORT = 3010;
const DEFAULT_RECONCILE_INTERVAL_MS = 60000;
const DEFAULT_WORKER_CONCURRENCY = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_LOG_LEVEL = 'info';
const DEFAULT_NODE_ENV = 'development';

const rawEnv = createEnv({
  server: {
    LOG_LEVEL: z
      .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'])
      .default(DEFAULT_LOG_LEVEL),
    NODE_ENV: z.enum(['development', 'test', 'production']).default(DEFAULT_NODE_ENV),
    REDIS_HOST: z.string().default(DEFAULT_REDIS_HOST),
    REDIS_PORT: z.coerce.number().int().positive().default(DEFAULT_REDIS_PORT),
    SCHEDULER_HOST: z.string().default(DEFAULT_SCHEDULER_HOST),
    SCHEDULER_PORT: z.coerce.number().int().positive().default(DEFAULT_SCHEDULER_PORT),
    SCHEDULER_RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_RECONCILE_INTERVAL_MS),
    SCHEDULER_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_REQUEST_TIMEOUT_MS),
    SCHEDULER_WORKER_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_WORKER_CONCURRENCY),
    WEB_APP_BASE_URL: z.url().default(DEFAULT_WEB_APP_BASE_URL),
  },
  runtimeEnv: process.env,
  skipValidation: process.env['SKIP_ENV_VALIDATION'] === 'true',
  emptyStringAsUndefined: true,
});

const normalizedWebAppBaseUrl = rawEnv.WEB_APP_BASE_URL.replace(/\/+$/, '');

export const env = {
  ...rawEnv,
  ACTIVE_CRONS_URL: `${normalizedWebAppBaseUrl}/api/plugins/trigger/cron`,
  CRON_TRIGGER_URL: `${normalizedWebAppBaseUrl}/api/plugins/trigger/cron`,
};
