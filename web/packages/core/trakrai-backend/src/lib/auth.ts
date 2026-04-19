import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';

import type { betterAuth } from 'better-auth';

import * as schema from '../db/auth-schema';

type AuthEmailUser = {
  email: string;
  name: string;
};

type TrakraiAuthEnv = {
  microsoftClientId: string;
  microsoftClientSecret: string;
  microsoftTenantId?: string;
  nodeEnv: 'development' | 'production' | 'test';
  vercelUrl?: string;
};

type CreateTrakraiAuthOptions = {
  db: Parameters<typeof drizzleAdapter>[0];
  env: TrakraiAuthEnv;
  sendResetPassword: (args: { url: string; user: AuthEmailUser }) => Promise<void>;
  sendVerificationEmail: (args: { url: string; user: AuthEmailUser }) => Promise<void>;
};

type BetterAuthOptionsInput = Parameters<typeof betterAuth>[0];

const SESSION_CACHE_MAX_AGE_MINUTES = 5;
const SECONDS_PER_MINUTE = 60;

const resolveTrustedOrigins = (env: TrakraiAuthEnv): string[] => {
  if (env.nodeEnv === 'development') {
    return ['http://localhost:3000', 'http://localhost:3100', 'http://localhost:3001'];
  }

  if (typeof env.vercelUrl === 'string' && env.vercelUrl.trim() !== '') {
    return [`https://${env.vercelUrl.trim()}`];
  }

  return [];
};

export const createTrakraiAuthOptions = ({
  db,
  env,
  sendResetPassword,
  sendVerificationEmail,
}: CreateTrakraiAuthOptions): BetterAuthOptionsInput => ({
  appName: 'trakrai',
  plugins: [
    admin(),
    passkey({
      rpID: env.nodeEnv === 'development' ? 'localhost' : undefined,
    }),
  ],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: SESSION_CACHE_MAX_AGE_MINUTES * SECONDS_PER_MINUTE,
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    customSyntheticUser: ({ additionalFields, coreFields, id }) => ({
      ...coreFields,
      role: 'user',
      banned: false,
      banReason: null,
      banExpires: null,
      ...additionalFields,
      id,
    }),
    sendResetPassword,
  },
  trustedOrigins: resolveTrustedOrigins(env),
  socialProviders: {
    microsoft: {
      clientId: env.microsoftClientId,
      clientSecret: env.microsoftClientSecret,
      tenantId: env.microsoftTenantId ?? 'common',
      authority: 'https://login.microsoftonline.com',
      prompt: 'select_account',
    },
  },
});
