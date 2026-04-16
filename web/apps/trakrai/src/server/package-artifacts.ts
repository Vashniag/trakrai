import path from 'node:path';

import { TRPCError } from '@trpc/server';

import { env } from '@/lib/env';
import { getStorageProvider } from '@/lib/storage';

import type {
  AvailablePackageArtifact,
  DeviceArtifactSessionInput,
  PackageArtifactSessionInput,
  StorageSignedRequest,
} from '@trakrai/cloud-api-contract/lib/package-artifacts';

const ARTIFACT_PATH_SEGMENT_COUNT = 4;
const DEFAULT_LIST_LIMIT = 500;
const DEVICE_STORAGE_PREFIX = 'devices';
const PACKAGE_STORAGE_PREFIX = 'device-packages';

const getStorage = () => getStorageProvider();

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

export const createPackageUploadSession = async (
  input: PackageArtifactSessionInput,
  headers: Headers,
): Promise<StorageSignedRequest> => {
  ensureAuthorized(
    headers,
    env.TRAKRAI_PACKAGE_RELEASE_TOKEN,
    'Package release token is missing or invalid.',
  );

  const storageProvider = getStorage();
  return storageProvider.getSignedUrlForUpload({
    accessTarget: 'public',
    contentType: input.contentType ?? 'application/octet-stream',
    key: joinKey(PACKAGE_STORAGE_PREFIX, normalizeSegments(input.path, 'path')),
  });
};

export const createPackageDownloadSession = async (input: {
  deviceId: string;
  path: string;
}): Promise<StorageSignedRequest> => {
  const storageProvider = getStorage();
  return storageProvider.getSignedUrlForDownload({
    accessTarget: 'device',
    key: joinKey(PACKAGE_STORAGE_PREFIX, normalizeSegments(input.path, 'path')),
  });
};

export const createDeviceUploadSession = async (
  input: DeviceArtifactSessionInput,
): Promise<StorageSignedRequest> => {
  const storageProvider = getStorage();
  return storageProvider.getSignedUrlForUpload({
    accessTarget: 'device',
    contentType: input.contentType ?? 'application/octet-stream',
    key: joinKey(DEVICE_STORAGE_PREFIX, [
      ...normalizeSegments(input.deviceId, 'deviceId'),
      ...normalizeSegments(input.path, 'path'),
    ]),
  });
};

export const createDeviceDownloadSession = async (
  input: Pick<DeviceArtifactSessionInput, 'deviceId' | 'path'>,
): Promise<StorageSignedRequest> => {
  const storageProvider = getStorage();
  return storageProvider.getSignedUrlForDownload({
    accessTarget: 'device',
    key: joinKey(DEVICE_STORAGE_PREFIX, [
      ...normalizeSegments(input.deviceId, 'deviceId'),
      ...normalizeSegments(input.path, 'path'),
    ]),
  });
};

export const listAvailablePackageArtifacts = async (
  serviceName?: string,
): Promise<AvailablePackageArtifact[]> => {
  let prefix = `${PACKAGE_STORAGE_PREFIX}/`;
  const prefixSegments = [PACKAGE_STORAGE_PREFIX];
  if (serviceName !== undefined && serviceName.trim() !== '') {
    prefixSegments.push(...normalizeSegments(serviceName, 'serviceName'));
    prefix = `${path.posix.join(...prefixSegments)}/`;
  }

  const storageProvider = getStorage();
  const providerName = storageProvider.getProviderName();
  const objects = await storageProvider.listObjects(prefix, DEFAULT_LIST_LIMIT);
  return objects
    .map((object) =>
      parsePackageArtifact(object.key, providerName, object.sizeBytes, object.updatedAt),
    )
    .filter((artifact): artifact is AvailablePackageArtifact => artifact !== null)
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
    });
};
