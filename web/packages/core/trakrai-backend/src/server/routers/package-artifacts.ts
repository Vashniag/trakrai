import path from 'node:path';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTRPCRouter, deviceProcedure, publicProcedure } from '../trpc';

const ARTIFACT_PATH_SEGMENT_COUNT = 4;
const DEFAULT_LIST_LIMIT = 500;
const DEVICE_STORAGE_PREFIX = 'devices';
const PACKAGE_STORAGE_PREFIX = 'device-packages';
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const storageSignedRequestSchema = z.object({
  bucket: z.string().min(1).optional(),
  expiresAt: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).default({}),
  method: z.string().min(1),
  objectKey: z.string().min(1).optional(),
  provider: z.enum(['AZURE', 'MINIO', 'S3']),
  url: z.url(),
});
const availablePackageArtifactSchema = z.object({
  artifactSha256: z.string().min(1).optional(),
  fileName: z.string().min(1),
  platform: z.string().min(1),
  provider: z.enum(['AZURE', 'MINIO', 'S3']),
  remotePath: z.string().min(1),
  serviceName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
  updatedAt: z.string().min(1).optional(),
  version: semverSchema,
});

const ensureAuthorized = (
  headers: Headers,
  expectedToken: string | undefined,
  message: string,
): void => {
  const normalizedExpectedToken = expectedToken?.trim();
  if (normalizedExpectedToken === undefined || normalizedExpectedToken === '') {
    return;
  }

  const headerValue = headers.get('Authorization') ?? headers.get('authorization') ?? '';
  const matchedToken = headerValue.startsWith('Bearer ') ? headerValue.slice('Bearer '.length) : '';
  if (matchedToken !== normalizedExpectedToken) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message });
  }
};

const normalizeSegments = (value: string, fieldName: string): string[] => {
  const normalized = value.trim().replace(/^\/+|\/+$/g, '');
  if (normalized === '') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${fieldName} is required` });
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${fieldName} must not contain empty, current-directory, or parent-directory segments`,
    });
  }

  return segments;
};

const joinKey = (prefixValue: string, segments: string[]): string =>
  path.posix.join(prefixValue, ...segments);

const compareSemverDesc = (left: string, right: string): number => {
  const leftParts = left.split('.').map((part) => Number(part));
  const rightParts = right.split('.').map((part) => Number(part));

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
};

const parsePackageArtifact = (
  objectKey: string,
  providerName: z.infer<typeof availablePackageArtifactSchema>['provider'],
  sizeBytes: number | undefined,
  updatedAt: string | undefined,
): z.infer<typeof availablePackageArtifactSchema> | null => {
  const expectedPrefix = `${PACKAGE_STORAGE_PREFIX}/`;
  if (!objectKey.startsWith(expectedPrefix)) {
    return null;
  }

  const relativePath = objectKey.slice(expectedPrefix.length);
  const segments = relativePath.split('/');
  if (segments.length !== ARTIFACT_PATH_SEGMENT_COUNT) {
    return null;
  }

  const serviceName = segments[0];
  const version = segments[1];
  const platform = segments[2];
  const fileName = segments[3];
  if (
    serviceName === undefined ||
    version === undefined ||
    platform === undefined ||
    fileName === undefined
  ) {
    return null;
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return null;
  }

  return {
    fileName,
    platform,
    provider: providerName,
    remotePath: relativePath,
    serviceName,
    sizeBytes,
    updatedAt,
    version,
  };
};

export const packageArtifactsRouter = createTRPCRouter({
  createDeviceDownloadSession: deviceProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/devices/download-session',
      },
    })
    .input(
      z.object({
        deviceId: z.string().min(1),
        path: z.string().min(1),
      }),
    )
    .output(storageSignedRequestSchema)
    .mutation(({ input, ctx }) =>
      ctx.storageProvider.getSignedUrlForDownload({
        accessTarget: 'device',
        key: joinKey(DEVICE_STORAGE_PREFIX, [
          ...normalizeSegments(input.deviceId, 'deviceId'),
          ...normalizeSegments(input.path, 'path'),
        ]),
      }),
    ),
  createDeviceUploadSession: deviceProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/devices/upload-session',
      },
    })
    .input(
      z.object({
        contentType: z.string().min(1).optional(),
        deviceId: z.string().min(1),
        path: z.string().min(1),
      }),
    )
    .output(storageSignedRequestSchema)
    .mutation(({ input, ctx }) =>
      ctx.storageProvider.getSignedUrlForUpload({
        accessTarget: 'device',
        contentType: input.contentType ?? 'application/octet-stream',
        key: joinKey(DEVICE_STORAGE_PREFIX, [
          ...normalizeSegments(input.deviceId, 'deviceId'),
          ...normalizeSegments(input.path, 'path'),
        ]),
      }),
    ),
  createPackageDownloadSession: deviceProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/packages/download-session',
      },
    })
    .input(
      z.object({
        deviceId: z.string().min(1),
        path: z.string().min(1),
      }),
    )
    .output(storageSignedRequestSchema)
    .mutation(({ input, ctx }) =>
      ctx.storageProvider.getSignedUrlForDownload({
        accessTarget: 'device',
        key: joinKey(PACKAGE_STORAGE_PREFIX, normalizeSegments(input.path, 'path')),
      }),
    ),
  createPackageUploadSession: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/packages/upload-session',
      },
    })
    .input(
      z.object({
        contentType: z.string().min(1).optional(),
        path: z.string().min(1),
        sha256: z.string().min(1).optional(),
      }),
    )
    .output(storageSignedRequestSchema)
    .mutation(({ ctx, input }) => {
      ensureAuthorized(
        ctx.headers,
        process.env.TRAKRAI_PACKAGE_RELEASE_TOKEN,
        'Package release token is missing or invalid.',
      );

      return ctx.storageProvider.getSignedUrlForUpload({
        accessTarget: 'public',
        contentType: input.contentType ?? 'application/octet-stream',
        key: joinKey(PACKAGE_STORAGE_PREFIX, normalizeSegments(input.path, 'path')),
      });
    }),
  listAvailable: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/storage/packages/releases',
      },
    })
    .input(
      z.object({
        serviceName: z.string().min(1).optional(),
      }),
    )
    .output(
      z.object({
        artifacts: z.array(availablePackageArtifactSchema),
      }),
    )
    .query(async ({ input, ctx }) => {
      let prefix = `${PACKAGE_STORAGE_PREFIX}/`;
      const prefixSegments = [PACKAGE_STORAGE_PREFIX];
      if (input.serviceName !== undefined && input.serviceName.trim() !== '') {
        prefixSegments.push(...normalizeSegments(input.serviceName, 'serviceName'));
        prefix = `${path.posix.join(...prefixSegments)}/`;
      }

      const providerName = ctx.storageProvider.getProviderName();
      const objects = await ctx.storageProvider.listObjects(prefix, DEFAULT_LIST_LIMIT);

      return {
        artifacts: objects
          .map((object) =>
            parsePackageArtifact(object.key, providerName, object.sizeBytes, object.updatedAt),
          )
          .filter(
            (artifact): artifact is z.infer<typeof availablePackageArtifactSchema> =>
              artifact !== null,
          )
          .sort((left, right) => {
            const serviceNameComparison = left.serviceName.localeCompare(right.serviceName);
            if (serviceNameComparison !== 0) {
              return serviceNameComparison;
            }

            const versionComparison = compareSemverDesc(left.version, right.version);
            if (versionComparison !== 0) {
              return versionComparison;
            }

            const platformComparison = left.platform.localeCompare(right.platform);
            if (platformComparison !== 0) {
              return platformComparison;
            }

            return left.fileName.localeCompare(right.fileName);
          }),
      };
    }),
});
