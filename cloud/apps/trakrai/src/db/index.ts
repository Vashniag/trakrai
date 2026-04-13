import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '@/lib/env';
import logger from '@/lib/logger';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', { error: err.message, stack: err.stack });
});

export const db = drizzle({
  client: pool,
  logger: {
    logQuery: (query, params) => {
      logger.info('Query Executed', {
        query: query,
        params: params,
      });
    },
  },
});

export type Database = typeof db;
