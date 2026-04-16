import process from 'node:process';

import pg from 'pg';

const { Client } = pg;

const args = process.argv.slice(2);
const emailIndex = args.findIndex((value) => value === '--email');
const email = emailIndex >= 0 ? args[emailIndex + 1] : undefined;

if (!email) {
  console.error('Usage: pnpm --filter trakrai admin:bootstrap -- --email someone@example.com');
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5439/trakrai';

const client = new Client({ connectionString });

try {
  await client.connect();
  const result = await client.query(
    `update "user"
     set "role" = 'admin',
         "updated_at" = now()
     where "email" = $1
     returning "id", "email", "role"`,
    [email],
  );

  if (result.rowCount === 0) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        user: result.rows[0],
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
