import { initTRPC, TRPCError, type inferRouterOutputs } from '@trpc/server';
import superjson from 'superjson';
import { treeifyError, ZodError, z } from 'zod';

import {
  createDevice,
  deleteDevice,
  getDeviceByCredentials,
  listDevices,
  updateDevice,
  type DeviceRecord,
} from './devices';
import {
  createPackageArtifactService,
  deviceArtifactSessionInputSchema,
  listPackageArtifactsInputSchema,
  listPackageArtifactsOutputSchema,
  packageArtifactDeviceDownloadSessionInputSchema,
  packageArtifactSessionInputSchema,
  storageSignedRequestSchema,
} from './package-artifacts';

import type { StorageProvider } from './storage/interface';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { OpenApiMeta } from 'trpc-to-openapi';

type CloudBackendDatabase = NodePgDatabase<Record<string, never>>;
type RequestContextWrapper = <TArgs extends Array<unknown>, TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
) => (...args: TArgs) => Promise<TReturn>;

export interface TrakraiCloudRequestContext {
  headers: Headers;
  setHeader: (key: string, value: string) => Promise<void>;
}

type SessionUser = Record<string, unknown>;

export interface TrakraiCloudBackendLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
}

export interface TrakraiCloudBackendDependencies {
  db: CloudBackendDatabase;
  logger: TrakraiCloudBackendLogger;
  packageReleaseToken?: string;
  resolveSession: (
    headers: Headers,
  ) => Promise<{
    setCookieHeader?: string | null;
    user: SessionUser | null;
  }>;
  storage: StorageProvider;
  withRequestContext?: RequestContextWrapper;
}

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_NAME_LENGTH = 255;
const MAX_DEVICE_ID_LENGTH = 255;
const SET_COOKIE_HEADER = 'set-cookie';
const BEARER_PREFIX = 'Bearer ';

const normalizeOptionalString = (value: string): string | null => {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
};

const createDeviceInputSchema = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  deviceId: z
    .string()
    .trim()
    .min(1, 'Device ID is required')
    .max(MAX_DEVICE_ID_LENGTH, 'Device ID must be 255 characters or fewer'),
  name: z
    .string()
    .trim()
    .min(1, 'Device name is required')
    .max(MAX_NAME_LENGTH, 'Device name must be 255 characters or fewer'),
});

const updateDeviceInputSchema = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  id: z.string().uuid('Device record ID must be a UUID'),
  isActive: z.boolean(),
  name: z
    .string()
    .trim()
    .min(1, 'Device name is required')
    .max(MAX_NAME_LENGTH, 'Device name must be 255 characters or fewer'),
});

const deleteDeviceInputSchema = z.object({
  id: z.string().uuid('Device record ID must be a UUID'),
});

const deviceOutputSchema = z.object({
  accessToken: z.string(),
  createdAt: z.date(),
  description: z.string().nullable(),
  deviceId: z.string(),
  id: z.string(),
  isActive: z.boolean(),
  name: z.string(),
  updatedAt: z.date(),
});

const isPgUniqueViolation = (error: unknown, constraintName: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '23505' &&
  'constraint' in error &&
  error.constraint === constraintName;

const identityRequestContext: RequestContextWrapper =
  <TArgs extends Array<unknown>, TReturn>(fn: (...args: TArgs) => Promise<TReturn>) =>
  (...args: TArgs) =>
    fn(...args);

const readBearerToken = (headers: Headers): string | null => {
  const headerValue = headers.get('Authorization') ?? headers.get('authorization') ?? '';
  const matchedToken = headerValue.startsWith(BEARER_PREFIX)
    ? headerValue.slice(BEARER_PREFIX.length).trim()
    : '';
  return matchedToken === '' ? null : matchedToken;
};

const readDeviceIdFromInput = (input: unknown): string | null => {
  if (typeof input !== 'object' || input === null || !('deviceId' in input)) {
    return null;
  }

  const candidate = input.deviceId;
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate.trim() : null;
};

export const createTrakraiCloudAppRouter = (deps: TrakraiCloudBackendDependencies) => {
  const t = initTRPC
    .meta<OpenApiMeta>()
    .context<TrakraiCloudRequestContext>()
    .create({
      transformer: superjson,
      errorFormatter: ({ error, shape }) => ({
        ...shape,
        data: {
          ...shape.data,
          zodError: error.cause instanceof ZodError ? treeifyError(error.cause) : null,
        },
      }),
    });

  const timingMiddleware = t.middleware(
    (deps.withRequestContext ?? identityRequestContext)(async ({ next, path }) => {
      const start = Date.now();
      const result = await next();
      const end = Date.now();
      deps.logger.info(`TRPC ${path} took ${end - start}ms to execute`, {
        durationMs: end - start,
        path,
      });
      return result;
    }),
  );
  const publicProcedure = t.procedure.use(timingMiddleware);
  const protectedProcedure = t.procedure.use(timingMiddleware).use(async ({ ctx, next }) => {
    const session = await deps.resolveSession(ctx.headers);
    if (session.setCookieHeader !== undefined && session.setCookieHeader !== null) {
      await ctx.setHeader(SET_COOKIE_HEADER, session.setCookieHeader);
    }
    if (session.user === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({
      ctx: {
        ...ctx,
        user: session.user,
      },
    });
  });

  const deviceProcedure = t.procedure.use(timingMiddleware).use(async ({ ctx, input, next }) => {
    const deviceId = readDeviceIdFromInput(input);
    if (deviceId === null) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'deviceId is required for device-authenticated routes.',
      });
    }

    const accessToken = readBearerToken(ctx.headers);
    if (accessToken === null) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Device access token is missing or invalid.',
      });
    }

    const device = await getDeviceByCredentials(deps.db, deviceId, accessToken);
    if (device === null) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Device access token is missing or invalid.',
      });
    }

    return next({
      ctx: {
        ...ctx,
        device,
      },
    });
  });

  const createTRPCRouter = t.router;
  const packageArtifactsService = createPackageArtifactService({
    packageReleaseToken: deps.packageReleaseToken,
    storage: deps.storage,
  });

  const devicesRouter = createTRPCRouter({
    create: protectedProcedure
      .input(createDeviceInputSchema)
      .output(deviceOutputSchema)
      .mutation(async ({ input }) => {
        try {
          return await createDevice(deps.db, {
            description: normalizeOptionalString(input.description),
            deviceId: input.deviceId,
            name: input.name,
          });
        } catch (error) {
          if (isPgUniqueViolation(error, 'device_device_id_unique')) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'A device with this device ID already exists.',
            });
          }

          throw error;
        }
      }),
    delete: protectedProcedure
      .input(deleteDeviceInputSchema)
      .output(deviceOutputSchema)
      .mutation(async ({ input }) => {
        const deletedDevice = await deleteDevice(deps.db, input.id);
        if (deletedDevice === null) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Device not found.',
          });
        }

        return deletedDevice;
      }),
    list: protectedProcedure
      .output(
        z.object({
          devices: z.array(deviceOutputSchema),
        }),
      )
      .query(async () => ({
        devices: await listDevices(deps.db),
      })),
    update: protectedProcedure
      .input(updateDeviceInputSchema)
      .output(deviceOutputSchema)
      .mutation(async ({ input }) => {
        const updatedDevice = await updateDevice(deps.db, {
          description: normalizeOptionalString(input.description),
          id: input.id,
          isActive: input.isActive,
          name: input.name,
        });
        if (updatedDevice === null) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Device not found.',
          });
        }

        return updatedDevice;
      }),
  });

  const packageArtifactsRouter = createTRPCRouter({
    createDeviceDownloadSession: deviceProcedure
      .meta({
        openapi: {
          method: 'POST',
          path: '/storage/devices/download-session',
        },
      })
      .input(deviceArtifactSessionInputSchema.pick({ deviceId: true, path: true }))
      .output(storageSignedRequestSchema)
      .mutation(({ input }) => packageArtifactsService.createDeviceDownloadSession(input)),
    createDeviceUploadSession: deviceProcedure
      .meta({
        openapi: {
          method: 'POST',
          path: '/storage/devices/upload-session',
        },
      })
      .input(deviceArtifactSessionInputSchema)
      .output(storageSignedRequestSchema)
      .mutation(({ input }) => packageArtifactsService.createDeviceUploadSession(input)),
    createPackageDownloadSession: deviceProcedure
      .meta({
        openapi: {
          method: 'POST',
          path: '/storage/packages/download-session',
        },
      })
      .input(packageArtifactDeviceDownloadSessionInputSchema)
      .output(storageSignedRequestSchema)
      .mutation(({ input }) => packageArtifactsService.createPackageDownloadSession(input)),
    createPackageUploadSession: publicProcedure
      .meta({
        openapi: {
          method: 'POST',
          path: '/storage/packages/upload-session',
        },
      })
      .input(packageArtifactSessionInputSchema)
      .output(storageSignedRequestSchema)
      .mutation(({ ctx, input }) =>
        packageArtifactsService.createPackageUploadSession(input, ctx.headers),
      ),
    listAvailable: publicProcedure
      .meta({
        openapi: {
          method: 'GET',
          path: '/storage/packages/releases',
        },
      })
      .input(listPackageArtifactsInputSchema)
      .output(listPackageArtifactsOutputSchema)
      .query(async ({ input }) => ({
        artifacts: await packageArtifactsService.listAvailablePackageArtifacts(input.serviceName),
      })),
  });

  return createTRPCRouter({
    devices: devicesRouter,
    health: publicProcedure.query(() => ({
      status: 'ok' as const,
      timestamp: new Date(),
    })),
    packageArtifacts: packageArtifactsRouter,
  });
};

export type TrakraiCloudAppRouter = ReturnType<typeof createTrakraiCloudAppRouter>;
export type TrakraiCloudRouterOutput = inferRouterOutputs<TrakraiCloudAppRouter>;
export type TrakraiCloudDeviceRecord = DeviceRecord;
