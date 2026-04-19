import { createDatabase } from '../packages/core/trakrai-backend/src/db/client.ts';

import {
  readRequiredEnvString,
  syncDeviceComponentCatalog,
  upsertSysadmin,
} from './lib/local-db-bootstrap.ts';

const main = async () => {
  const { db, pool } = createDatabase({
    connectionString: readRequiredEnvString('DATABASE_URL'),
  });

  try {
    const [sysadmin, catalog] = await Promise.all([
      upsertSysadmin(db),
      syncDeviceComponentCatalog(db),
    ]);

    console.log(
      JSON.stringify(
        {
          catalog,
          sysadmin,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
