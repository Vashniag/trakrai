import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '@/db';
import * as schema from '@/db/auth-schema';
import AuthEmail from '@/emails/auth-email';
import { env } from '@/lib/env';

import { sendEmail } from './send-email';

const SESSION_CACHE_MAX_AGE_MINUTES = 5;
const SECONDS_PER_MINUTE = 60;

const resolveTrustedOrigins = (): string[] => {
  if (env.NODE_ENV === 'development') {
    return ['http://localhost:3000', 'http://localhost:3100'];
  }

  if (env.VERCEL_URL !== undefined) {
    return [`https://${env.VERCEL_URL}`];
  }

  return [];
};

export const auth = betterAuth({
  appName: 'trakrai',
  plugins: [
    passkey({
      rpID: env.NODE_ENV === 'development' ? 'localhost' : undefined,
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
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(
        [user.email],
        'Verify your email',
        AuthEmail({
          userName: user.name,
          actionUrl: url,
          previewText: 'Verify your TrakrAI email',
          heading: 'Email verification',
          body: 'Please verify your email address to complete your registration.',
          buttonText: 'Verify Email',
        }),
      );
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(
        [user.email],
        'Reset your password',
        AuthEmail({
          userName: user.name,
          actionUrl: url,
          previewText: 'Reset your TrakrAI password',
          heading: 'Password reset',
          body: 'Someone recently requested a password change for your TrakrAI account. If this was you, you can set a new password here:',
          buttonText: 'Reset Password',
        }),
      );
    },
  },
  trustedOrigins: resolveTrustedOrigins(),
  socialProviders: {
    microsoft: {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      tenantId: env.MICROSOFT_TENANT_ID,
      authority: 'https://login.microsoftonline.com',
      prompt: 'select_account',
    },
  },
});
