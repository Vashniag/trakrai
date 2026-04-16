import {
  createTrakraiCloudAppRouter,
  type TrakraiCloudAppRouter,
  type TrakraiCloudRequestContext,
} from '@trakrai/cloud-backend/router';

import { db } from '@/db';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import logger from '@/lib/logger';
import { withRequestContext } from '@/lib/request-context';
import { getStorageProvider } from '@/lib/storage';

export const createTRPCContext = (opts: TrakraiCloudRequestContext): TrakraiCloudRequestContext =>
  opts;

export const createTRPCContextNext = async (
  req: Request,
  setHeader: (key: string, value: string) => Promise<void>,
): Promise<TrakraiCloudRequestContext> => ({
  headers: req.headers,
  setHeader,
});

export const appRouter: TrakraiCloudAppRouter = createTrakraiCloudAppRouter({
  db,
  logger,
  packageReleaseToken: env.TRAKRAI_PACKAGE_RELEASE_TOKEN,
  resolveSession: async (headers) => {
    const { headers: responseHeaders, response: session } = await auth.api.getSession({
      headers,
      returnHeaders: true,
    });

    return {
      setCookieHeader: responseHeaders.get('set-cookie'),
      user: session?.user ?? null,
    };
  },
  storage: getStorageProvider(),
  withRequestContext,
});
