import { createDatabase } from '@trakrai/backend/db/client';

import { env } from '@/lib/env';
import logger from '@/lib/logger';

const database = createDatabase({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 30000,
  logQuery: (query, params) => {
    logger.info('Query Executed', {
      query,
      params,
    });
  },
  max: 20,
});
const { db, pool } = database;
export { db };

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', { error: err.message, stack: err.stack });
});
