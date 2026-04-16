import { env } from '@/lib/env';

import { AzureBlobStorageProvider } from './azure-provider';
import { S3CompatibleStorageProvider } from './s3-compatible-provider';

import type { StorageProvider } from './interface';

const normalizeOptional = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === '' ? undefined : normalized;
};

const resolveMinioConfig = () => {
  const endpoint = normalizeOptional(env.MINIO_ENDPOINT) ?? 'http://127.0.0.1:19000';
  const deviceEndpoint =
    normalizeOptional(env.MINIO_DEVICE_ENDPOINT) ?? 'http://host.docker.internal:19000';
  const accessKey = normalizeOptional(env.MINIO_ACCESS_KEY) ?? 'minioadmin';
  const secretKey = normalizeOptional(env.MINIO_SECRET_KEY) ?? 'minioadmin';
  const bucketName = normalizeOptional(env.MINIO_BUCKET_NAME) ?? 'trakrai-local';
  const region = normalizeOptional(env.MINIO_REGION) ?? 'us-east-1';

  return {
    accessKeyId: accessKey,
    bucketName,
    deviceEndpoint,
    ensureBucketExists: true,
    forcePathStyle: true,
    providerName: 'MINIO' as const,
    publicEndpoint: endpoint,
    region,
    secretAccessKey: secretKey,
    serverEndpoint: endpoint,
  };
};

const createStorageProvider = (): StorageProvider => {
  switch (env.STORAGE_PROVIDER) {
    case 'AZURE':
      if (
        env.AZURE_STORAGE_ACCOUNT_NAME === undefined ||
        env.AZURE_STORAGE_ACCOUNT_KEY === undefined ||
        env.AZURE_STORAGE_CONTAINER_NAME === undefined
      ) {
        throw new Error(
          'AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_ACCOUNT_KEY, and AZURE_STORAGE_CONTAINER_NAME are required when STORAGE_PROVIDER=AZURE',
        );
      }

      return new AzureBlobStorageProvider({
        accountKey: env.AZURE_STORAGE_ACCOUNT_KEY,
        accountName: env.AZURE_STORAGE_ACCOUNT_NAME,
        containerName: env.AZURE_STORAGE_CONTAINER_NAME,
      });
    case 'MINIO':
      return new S3CompatibleStorageProvider(resolveMinioConfig());
    case 'S3':
      if (
        env.AWS_ACCESS_KEY_ID === undefined ||
        env.AWS_SECRET_ACCESS_KEY === undefined ||
        env.AWS_REGION === undefined ||
        env.S3_BUCKET_NAME === undefined
      ) {
        throw new Error(
          'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and S3_BUCKET_NAME are required when STORAGE_PROVIDER=S3',
        );
      }

      return new S3CompatibleStorageProvider({
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        bucketName: env.S3_BUCKET_NAME,
        providerName: 'S3',
        publicEndpoint: undefined,
        region: env.AWS_REGION,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        serverEndpoint: undefined,
      });
  }
};

let storageProvider: StorageProvider | null = null;

export const getStorageProvider = (): StorageProvider => {
  storageProvider ??= createStorageProvider();
  return storageProvider;
};

export const resetStorageProvider = (): void => {
  storageProvider = null;
};
