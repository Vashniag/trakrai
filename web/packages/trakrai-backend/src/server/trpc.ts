import { initTRPC, TRPCError } from '@trpc/server';
import { and, eq, type EmptyRelations } from 'drizzle-orm';
import { type Pool } from 'pg';
import superjson from 'superjson';
import { treeifyError, ZodError } from 'zod';

import type { StorageProvider } from '../lib/storage/interface';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { OpenApiMeta } from 'trpc-to-openapi';
import type winston from 'winston';

import { device } from '../db/schema';
import { withRequestContext } from '../lib/request-context';

export type Database = NodePgDatabase<Record<string, never>, EmptyRelations> & {
  $client: Pool;
};

const t = initTRPC
  .meta<OpenApiMeta>()
  .context<Context>()
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
  withRequestContext(async ({ next, path, ctx }) => {
    const start = Date.now();
    const result = await next();
    const end = Date.now();
    ctx.logger.info(`TRPC ${path} took ${end - start}ms to execute`, {
      path,
      durationMs: end - start,
    });
    return result;
  }),
);

type Context = {
  db: Database;
  headers: Headers;
  setHeader: (key: string, value: string) => Promise<void>;
  logger: winston.Logger;
  storageProvider: StorageProvider;
  getSession: (context: {
    headers: Headers;
    query?:
      | {
          disableCookieCache?: boolean | undefined;
          disableRefresh?: boolean | undefined;
        }
      | undefined;
    asResponse?: boolean | undefined;
    returnHeaders?: true | undefined;
  }) => Promise<{
    headers: Headers;
    response: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
      };
    } | null;
  }>;
};

export const createTRPCRouter = t.router;

export const { createCallerFactory } = t;

export const publicProcedure = t.procedure.use(timingMiddleware);

const SET_COOKIE_HEADER = 'set-cookie';
const BEARER_PREFIX = 'Bearer ';

export const protectedProcedure = t.procedure.use(timingMiddleware).use(async ({ ctx, next }) => {
  const { response: session, headers } = await ctx.getSession({
    headers: ctx.headers,
    returnHeaders: true,
  });
  if (headers.get(SET_COOKIE_HEADER) !== null) {
    const setCookieValue = headers.get(SET_COOKIE_HEADER);
    if (setCookieValue !== null) {
      await ctx.setHeader(SET_COOKIE_HEADER, setCookieValue);
    }
  }
  if (session === null) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      user: session.user,
    },
  });
});

const readDeviceIdFromInput = (input: unknown): string | null => {
  if (typeof input !== 'object' || input === null || !('deviceId' in input)) {
    return null;
  }

  const candidate = input.deviceId;
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate.trim() : null;
};

const readBearerToken = (headers: Headers): string | null => {
  const headerValue = headers.get('Authorization') ?? headers.get('authorization') ?? '';
  const matchedToken = headerValue.startsWith(BEARER_PREFIX)
    ? headerValue.slice(BEARER_PREFIX.length).trim()
    : '';
  return matchedToken === '' ? null : matchedToken;
};

export const deviceProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, getRawInput, input, next }) => {
    const deviceId = readDeviceIdFromInput(input) ?? readDeviceIdFromInput(await getRawInput());
    if (deviceId === null) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'deviceId is required for device-authenticated routes.',
      });
    }
    let foundDevice: Device | undefined = undefined;
    const accessToken = readBearerToken(ctx.headers);
    if (accessToken !== null) {
      const devices = await ctx.db
        .select()
        .from(device)
        .where(
          and(
            eq(device.accessToken, accessToken),
            eq(device.isActive, true),
            eq(device.deviceId, deviceId),
          ),
        )
        .limit(1);
      foundDevice = devices[0];
    } else {
      const { response: session, headers } = await ctx.getSession({
        headers: ctx.headers,
        returnHeaders: true,
      });
      if (headers.get(SET_COOKIE_HEADER) !== null) {
        const setCookieValue = headers.get(SET_COOKIE_HEADER);
        if (setCookieValue !== null) {
          await ctx.setHeader(SET_COOKIE_HEADER, setCookieValue);
        }
      }
      if (session !== null) {
        const devices = await ctx.db
          .select()
          .from(device)
          .where(and(eq(device.isActive, true), eq(device.deviceId, deviceId)))
          .limit(1);
        foundDevice = devices[0];
      }
    }

    if (foundDevice === undefined) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Device access token is missing or invalid.',
      });
    }

    return next({
      ctx: {
        ...ctx,
        device: foundDevice,
      },
    });
  });

type Device = {
  id: string;
  deviceId: string;
  name: string;
  description: string | null;
  accessToken: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};
