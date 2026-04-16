import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    NODE_ENV: z.enum(['development', 'test', 'production']),
    BETTER_AUTH_SECRET: z.string(),
    BETTER_AUTH_URL: z.string(),
    MICROSOFT_CLIENT_ID: z.string(),
    MICROSOFT_CLIENT_SECRET: z.string(),
    MICROSOFT_TENANT_ID: z.string().default('common'),
    SMTP_SERVER: z.string(),
    SMTP_USER: z.string(),
    SMTP_PASSWORD: z.string(),
    EMAIL_SENDER_ADDRESS: z.string(),
    PLATFORM_ADMIN_EMAILS: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_BASE_URL: z.string().optional(),
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env['NODE_ENV'],
    BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
    BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
    MICROSOFT_CLIENT_ID: process.env['MICROSOFT_CLIENT_ID'],
    MICROSOFT_CLIENT_SECRET: process.env['MICROSOFT_CLIENT_SECRET'],
    MICROSOFT_TENANT_ID: process.env['MICROSOFT_TENANT_ID'],
    SMTP_SERVER: process.env.SMTP_SERVER,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    EMAIL_SENDER_ADDRESS: process.env['EMAIL_SENDER_ADDRESS'],
    PLATFORM_ADMIN_EMAILS: process.env['PLATFORM_ADMIN_EMAILS'],
    NEXT_PUBLIC_BASE_URL: process.env['NEXT_PUBLIC_BASE_URL'],
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL:
      process.env['NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL'],
  },
  skipValidation:
    process.env['SKIP_ENV_VALIDATION'] !== undefined &&
    process.env['SKIP_ENV_VALIDATION'] === 'true',
  emptyStringAsUndefined: true,
});
