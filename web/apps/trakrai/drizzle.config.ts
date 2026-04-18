import { defineConfig } from 'drizzle-kit';

import { env } from './src/lib/env';

export default defineConfig({
  out: './drizzle',
  schema: [
    '../../packages/trakrai-backend/src/db/schema.ts',
    '../../packages/trakrai-backend/src/db/auth-schema.ts',
  ],
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
