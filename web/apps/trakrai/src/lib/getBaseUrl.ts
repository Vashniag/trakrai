import { env } from '@/lib/env';

export const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  if (env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL !== undefined) {
    return `https://${env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.NEXT_PUBLIC_BASE_URL !== undefined) {
    return env.NEXT_PUBLIC_BASE_URL;
  }

  return `http://localhost:${env.PORT}`;
};
