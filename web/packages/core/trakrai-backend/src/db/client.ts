import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as authSchema from './auth-schema';
import * as appSchema from './schema';

export const databaseSchema = {
  ...authSchema,
  ...appSchema,
};

export type DatabaseSchema = typeof databaseSchema;
export type DatabaseClient = NodePgDatabase<DatabaseSchema>;

type CreateDatabaseOptions = Readonly<{
  connectionString: string;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  logQuery?: (query: string, params: unknown[]) => void;
  max?: number;
}>;

export const createDatabasePool = ({
  connectionString,
  connectionTimeoutMillis = 2000,
  idleTimeoutMillis = 30000,
  max = 20,
}: CreateDatabaseOptions): Pool =>
  new Pool({
    connectionString,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    max,
  });

export const createDatabase = (options: CreateDatabaseOptions) => {
  const pool = createDatabasePool(options);
  const db = drizzle({
    client: pool,
    logger:
      options.logQuery === undefined
        ? undefined
        : {
            logQuery: (query, params) => {
              options.logQuery?.(query, params);
            },
          },
    schema: databaseSchema,
  });

  return {
    db,
    pool,
  };
};
