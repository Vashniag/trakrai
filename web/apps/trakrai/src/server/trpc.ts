import { db } from '@/db';
import { auth } from '@/lib/auth';
import logger from '@/lib/logger';
import { getStorageProvider } from '@/lib/storage';

import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';

type CreateTRPCContextOptions = {
  headers: Headers;
  setHeader: (key: string, value: string) => Promise<void>;
};

export const createTRPCContext = ({ headers, setHeader }: CreateTRPCContextOptions) => {
  return {
    db,
    getSession: auth.api.getSession,
    headers,
    logger,
    setHeader,
    storageProvider: getStorageProvider(),
  };
};

export type AppTRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

export const createTRPCContextNext = async (
  { req }: FetchCreateContextFnOptions,
  setHeader: (key: string, value: string) => Promise<void>,
): Promise<AppTRPCContext> =>
  createTRPCContext({
    headers: req.headers,
    setHeader,
  });
