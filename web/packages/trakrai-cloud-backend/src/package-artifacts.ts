import path from 'node:path';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type {
  StorageObjectSummary,
  StorageProvider,
  StorageSignedRequest,
} from './storage/interface';

const ARTIFACT_PATH_SEGMENT_COUNT = 4;
const DEFAULT_LIST_LIMIT = 500;
const DEVICE_STORAGE_PREFIX = 'devices';
const PACKAGE_STORAGE_PREFIX = 'device-packages';

export const storageSignedRequestSchema = z.object({
  bucket: z.string().min(1).optional(),
  expiresAt: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).default({}),
  method: z.string().min(1),
  objectKey: z.string().min(1).optional(),
  provider: z.enum(['AZURE', 'MINIO', 'S3']),
  url: z.url(),
});

export const listPackageArtifactsInputSchema = z.object({
  serviceName: z.string().min(1).optional(),
});

const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const availablePackageArtifactSchema = z.object({
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

export const listPackageArtifactsOutputSchema = z.object({
  artifacts: z.array(availablePackageArtifactSchema),
});

export const packageArtifactSessionInputSchema = z.object({
  contentType: z.string().min(1).optional(),
  path: z.string().min(1),
  sha256: z.string().min(1).optional(),
});

export const deviceArtifactSessionInputSchema = z.object({
  contentType: z.string().min(1).optional(),
  deviceId: z.string().min(1),
  path: z.string().min(1),
});

export const packageArtifactDeviceDownloadSessionInputSchema = z.object({
  deviceId: z.string().min(1),
  path: z.string().min(1),
});

export type AvailablePackageArtifact = z.infer<typeof availablePackageArtifactSchema>;
export type DeviceArtifactSessionInput = z.infer<typeof deviceArtifactSessionInputSchema>;
export type ListPackageArtifactsInput = z.infer<typeof listPackageArtifactsInputSchema>;
export type ListPackageArtifactsOutput = z.infer<typeof listPackageArtifactsOutputSchema>;
export type PackageArtifactSessionInput = z.infer<typeof packageArtifactSessionInputSchema>;

type PackageArtifactServiceDependencies = Readonly<{
  packageReleaseToken?: string;
  storage: StorageProvider;
}>;

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
  providerName: AvailablePackageArtifact['provider'],
  sizeBytes: number | undefined,
  updatedAt: string | undefined,
): AvailablePackageArtifact | null => {
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

export const createPackageArtifactService = ({
  packageReleaseToken,
  storage,
}: PackageArtifactServiceDependencies) => ({
  createDeviceDownloadSession: async (
    input: Pick<DeviceArtifactSessionInput, 'deviceId' | 'path'>,
  ): Promise<StorageSignedRequest> =>
    storage.getSignedUrlForDownload({
      accessTarget: 'device',
      key: joinKey(DEVICE_STORAGE_PREFIX, [
        ...normalizeSegments(input.deviceId, 'deviceId'),
        ...normalizeSegments(input.path, 'path'),
      ]),
    }),
  createDeviceUploadSession: async (
    input: DeviceArtifactSessionInput,
  ): Promise<StorageSignedRequest> =>
    storage.getSignedUrlForUpload({
      accessTarget: 'device',
      contentType: input.contentType ?? 'application/octet-stream',
      key: joinKey(DEVICE_STORAGE_PREFIX, [
        ...normalizeSegments(input.deviceId, 'deviceId'),
        ...normalizeSegments(input.path, 'path'),
      ]),
    }),
  createPackageDownloadSession: async (
    input: { deviceId: string; path: string },
  ): Promise<StorageSignedRequest> =>
    storage.getSignedUrlForDownload({
      accessTarget: 'device',
      key: joinKey(PACKAGE_STORAGE_PREFIX, normalizeSegments(input.path, 'path')),
    }),
  createPackageUploadSession: async (
    input: PackageArtifactSessionInput,
    headers: Headers,
  ): Promise<StorageSignedRequest> => {
    ensureAuthorized(
      headers,
      packageReleaseToken,
      'Package release token is missing or invalid.',
    );

    return storage.getSignedUrlForUpload({
      accessTarget: 'public',
      contentType: input.contentType ?? 'application/octet-stream',
      key: joinKey(PACKAGE_STORAGE_PREFIX, normalizeSegments(input.path, 'path')),
    });
  },
  listAvailablePackageArtifacts: async (
    serviceName?: string,
  ): Promise<AvailablePackageArtifact[]> => {
    let prefix = `${PACKAGE_STORAGE_PREFIX}/`;
    const prefixSegments = [PACKAGE_STORAGE_PREFIX];
    if (serviceName !== undefined && serviceName.trim() !== '') {
      prefixSegments.push(...normalizeSegments(serviceName, 'serviceName'));
      prefix = `${path.posix.join(...prefixSegments)}/`;
    }

    const providerName = storage.getProviderName();
    const objects: StorageObjectSummary[] = await storage.listObjects(prefix, DEFAULT_LIST_LIMIT);
    return objects
      .map((object: StorageObjectSummary) =>
        parsePackageArtifact(object.key, providerName, object.sizeBytes, object.updatedAt),
      )
      .filter(
        (artifact: AvailablePackageArtifact | null): artifact is AvailablePackageArtifact =>
          artifact !== null,
      )
      .sort((left: AvailablePackageArtifact, right: AvailablePackageArtifact) => {
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
      });
  },
});
