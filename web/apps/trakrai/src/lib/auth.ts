import { createTrakraiAuthOptions } from '@trakrai/backend/lib/auth';
import { betterAuth } from 'better-auth';

import { db } from '@/db';
import AuthEmail from '@/emails/auth-email';
import { env } from '@/lib/env';

import { sendEmail } from './send-email';

export const auth = betterAuth(
  createTrakraiAuthOptions({
    db,
    env: {
      microsoftClientId: env.MICROSOFT_CLIENT_ID,
      microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
      microsoftTenantId: env.MICROSOFT_TENANT_ID,
      nodeEnv: env.NODE_ENV,
      vercelUrl: env.VERCEL_URL,
    },
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
  }),
);
