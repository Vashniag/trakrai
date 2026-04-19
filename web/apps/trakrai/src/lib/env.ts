import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import { DEFAULT_PORT } from './constants';

export const env = createEnv({
  server: {
    // Local source: `web/apps/trakrai/.env`.
    // Deployment source: the cloud app runtime environment.
    // Get this from the Postgres instance backing the `trakrai` cloud app.
    DATABASE_URL: z.url(),

    // Local source: `web/apps/trakrai/.env`.
    // Deployment source: the cloud app runtime environment.
    // Set this to the storage backend the cloud API should use for device objects and package artifacts.
    STORAGE_PROVIDER: z.enum(['AZURE', 'MINIO', 'S3']).default('MINIO'),

    // Local/deploy source: cloud storage credentials for the selected `STORAGE_PROVIDER=S3`.
    // Get these from the AWS IAM principal and bucket provisioned for package/device storage.
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET_NAME: z.string().optional(),

    // Local/deploy source: cloud storage credentials for the selected `STORAGE_PROVIDER=AZURE`.
    // Get these from the Azure Blob Storage account/container used for package/device storage.
    AZURE_STORAGE_ACCOUNT_NAME: z.string().optional(),
    AZURE_STORAGE_ACCOUNT_KEY: z.string().optional(),
    AZURE_STORAGE_CONTAINER_NAME: z.string().optional(),

    // Local source: `web/apps/trakrai/.env` when using the local MinIO stack.
    // Deployment source: leave unset unless a deployed environment is intentionally using MinIO.
    // Get these from `device/localdev/docker-compose.yml` or your MinIO deployment.
    MINIO_ACCESS_KEY: z.string().optional(),
    MINIO_BUCKET_NAME: z.string().optional(),
    MINIO_DEVICE_ENDPOINT: z.string().url().optional(),
    MINIO_ENDPOINT: z.string().url().optional(),
    MINIO_REGION: z.string().optional(),
    MINIO_SECRET_KEY: z.string().optional(),

    // Used by package publishing flows.
    // Local source: shell env when running `python3 -m device.devtool package release`.
    // CI source: GitHub Actions secret used in `.github/workflows/publish-device-binaries.yml`.
    TRAKRAI_PACKAGE_RELEASE_TOKEN: z.string().optional(),

    // Local source: `web/apps/trakrai/.env`.
    // Deployment source: auth provider secret configured for the cloud app.
    // Get these from your Better Auth app registration / deployment secret store.
    BETTER_AUTH_SECRET: z.string(),
    BETTER_AUTH_URL: z.string(),

    // Local source: `web/apps/trakrai/.env`, usually `http://localhost:8080`.
    // Deployment source: URL of the OpenFGA HTTP API used for authz graph checks.
    OPENFGA_API_URL: z.string().url(),
    OPENFGA_STORE_NAME: z.string().default('trakrai'),

    // Shared signing secret for short-lived device gateway access tokens.
    // Must match the value configured for the live-gateway service.
    LIVE_GATEWAY_AUTH_SECRET: z.string(),

    // Local source: `web/apps/trakrai/.env`.
    // Deployment source: cloud app runtime environment.
    // Get these from the Microsoft Entra / Azure AD application used for login.
    MICROSOFT_CLIENT_ID: z.string(),
    MICROSOFT_CLIENT_SECRET: z.string(),
    MICROSOFT_TENANT_ID: z.string().default('common'),

    // Local source: `web/apps/trakrai/.env`.
    // Deployment source: cloud app runtime environment.
    // Get these from the SMTP provider used for auth emails.
    SMTP_SERVER: z.string(),
    SMTP_USER: z.string(),
    SMTP_PASSWORD: z.string(),
    EMAIL_SENDER_ADDRESS: z.string(),

    // Deployment-only host injected by Vercel.
    // Do not set this locally unless you are emulating Vercel routing behavior.
    VERCEL_URL: z.string().optional(),
  },
  shared: {
    // Used by both server and build-time code.
    // Local source: `web/apps/trakrai/.env` or the shell that starts Next.js.
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // Next.js listen port for the cloud app.
    // Local source: `web/apps/trakrai/.env` or `pnpm dev` shell env.
    // Deployment source: platform runtime env if the host overrides the default.
    PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  },
  client: {
    // Public browser base URL for the cloud app.
    // Use when the deployed public URL is known and should not be inferred at runtime.
    NEXT_PUBLIC_BASE_URL: z.string().optional(),

    // Public base URL for the live-gateway service that fronts MQTT/WebSocket traffic.
    // Local source: `web/apps/trakrai/.env`, usually `http://localhost:4000`.
    // Deployment source: the public or internal URL where `live-gateway` is reachable.
    NEXT_PUBLIC_TRAKRAI_CLOUD_GATEWAY_BASE_URL: z.string().optional(),
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  },

  // Public production hostname, typically injected by deployment/platform config.
  // Used for absolute URL generation in browser-safe code paths.
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env['NODE_ENV'],
    STORAGE_PROVIDER: process.env['STORAGE_PROVIDER'],
    AWS_ACCESS_KEY_ID: process.env['AWS_ACCESS_KEY_ID'],
    AWS_REGION: process.env['AWS_REGION'],
    AWS_SECRET_ACCESS_KEY: process.env['AWS_SECRET_ACCESS_KEY'],
    S3_BUCKET_NAME: process.env['S3_BUCKET_NAME'],
    AZURE_STORAGE_ACCOUNT_NAME: process.env['AZURE_STORAGE_ACCOUNT_NAME'],
    AZURE_STORAGE_ACCOUNT_KEY: process.env['AZURE_STORAGE_ACCOUNT_KEY'],
    AZURE_STORAGE_CONTAINER_NAME: process.env['AZURE_STORAGE_CONTAINER_NAME'],
    MINIO_ACCESS_KEY: process.env['MINIO_ACCESS_KEY'],
    MINIO_BUCKET_NAME: process.env['MINIO_BUCKET_NAME'],
    MINIO_DEVICE_ENDPOINT: process.env['MINIO_DEVICE_ENDPOINT'],
    MINIO_ENDPOINT: process.env['MINIO_ENDPOINT'],
    MINIO_REGION: process.env['MINIO_REGION'],
    MINIO_SECRET_KEY: process.env['MINIO_SECRET_KEY'],
    TRAKRAI_PACKAGE_RELEASE_TOKEN: process.env['TRAKRAI_PACKAGE_RELEASE_TOKEN'],
    BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
    BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
    OPENFGA_API_URL: process.env['OPENFGA_API_URL'],
    OPENFGA_STORE_NAME: process.env['OPENFGA_STORE_NAME'],
    LIVE_GATEWAY_AUTH_SECRET: process.env['LIVE_GATEWAY_AUTH_SECRET'],
    MICROSOFT_CLIENT_ID: process.env['MICROSOFT_CLIENT_ID'],
    MICROSOFT_CLIENT_SECRET: process.env['MICROSOFT_CLIENT_SECRET'],
    MICROSOFT_TENANT_ID: process.env['MICROSOFT_TENANT_ID'],
    SMTP_SERVER: process.env.SMTP_SERVER,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    EMAIL_SENDER_ADDRESS: process.env['EMAIL_SENDER_ADDRESS'],
    PORT: process.env['PORT'],
    NEXT_PUBLIC_BASE_URL: process.env['NEXT_PUBLIC_BASE_URL'],
    NEXT_PUBLIC_TRAKRAI_CLOUD_GATEWAY_BASE_URL:
      process.env['NEXT_PUBLIC_TRAKRAI_CLOUD_GATEWAY_BASE_URL'],
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL:
      process.env['NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL'],
    VERCEL_URL: process.env['VERCEL_URL'],
  },
  skipValidation:
    process.env['SKIP_ENV_VALIDATION'] !== undefined &&
    process.env['SKIP_ENV_VALIDATION'] === 'true',
  emptyStringAsUndefined: true,
  // Escape hatch for CI or partial local setups where not all secrets are available.
  // Prefer fixing missing env over relying on this.
});
