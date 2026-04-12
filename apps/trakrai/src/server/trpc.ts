import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { treeifyError, ZodError } from 'zod';

import { db } from '@/db';
import logger from '@/lib/logger';
import { withRequestContext } from '@/lib/request-context';

import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import type { OpenApiMeta } from 'trpc-to-openapi';

const t = initTRPC
  .meta<OpenApiMeta>()
  .context<typeof createTRPCContext>()
  .create({
    transformer: superjson,
    errorFormatter: ({ shape, error }) => ({
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? treeifyError(error.cause) : null,
      },
    }),
  });

const timingMiddleware = t.middleware(
  withRequestContext(async ({ next, path }) => {
    const start = Date.now();
    const result = await next();
    const end = Date.now();
    logger.info(`TRPC ${path} took ${end - start}ms to execute`, {
      path,
      durationMs: end - start,
    });
    return result;
  }),
);

export const createTRPCContext = (opts: {
  headers: Headers;
  setHeader: (key: string, value: string) => Promise<void>;
}) => {
  return {
    ...opts,
    db: db,
  };
};

type Context = Awaited<ReturnType<typeof createTRPCContext>>;

export const createTRPCContextNext = async (
  { req }: FetchCreateContextFnOptions,
  setHeader: (key: string, value: string) => Promise<void>,
): Promise<Context> => {
  return {
    db: db,
    headers: req.headers,
    setHeader,
  };
};

export const createTRPCRouter = t.router;

export const { createCallerFactory } = t;

export const publicProcedure = t.procedure.use(timingMiddleware);

// Placeholder — will be wired to better-auth in the auth setup step
export const protectedProcedure = t.procedure.use(timingMiddleware).use(async ({ ctx, next }) => {
  // TODO: Replace with better-auth session check
  void ctx;
  throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Auth not configured yet' });
  return next({ ctx });
});
