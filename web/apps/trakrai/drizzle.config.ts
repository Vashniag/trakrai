import { defineConfig } from 'drizzle-kit';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const appRoot = dirname(fileURLToPath(import.meta.url));
const envFilePath = `${appRoot}\\.env.local`;

if (existsSync(envFilePath)) {
  const envFile = readFileSync(envFilePath, 'utf8');

  for (const line of envFile.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();

    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(`DATABASE_URL is not defined for drizzle config in ${appRoot}`);
}

export default defineConfig({
  out: './drizzle',
  schema: ['./src/db/schema.ts'],
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
