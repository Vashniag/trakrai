import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  DownloadOptions,
  SignedUrlOptions,
  StorageAccessTarget,
  StorageObjectSummary,
  StorageProvider,
  StorageProviderName,
  StorageSignedRequest,
  UploadOptions,
} from './interface';

type S3CompatibleConfig = {
  accessKeyId: string;
  bucketName: string;
  deviceEndpoint?: string;
  ensureBucketExists?: boolean;
  forcePathStyle?: boolean;
  providerName: StorageProviderName;
  publicEndpoint?: string;
  region: string;
  secretAccessKey: string;
  serverEndpoint?: string;
};

type ClientMode = 'device' | 'public' | 'server';

const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 3600;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const MILLISECONDS_IN_SECOND = 1000;

export class S3CompatibleStorageProvider implements StorageProvider {
  private readonly bucketName: string;
  private readonly clients: Record<ClientMode, S3Client>;
  private readonly ensureBucketExistsEnabled: boolean;
  private ensureBucketExistsPromise: Promise<void> | null = null;
  private readonly providerName: StorageProviderName;

  constructor(config: S3CompatibleConfig) {
    this.bucketName = config.bucketName;
    this.ensureBucketExistsEnabled = config.ensureBucketExists ?? false;
    this.providerName = config.providerName;
    this.clients = {
      device: this.createClient(config, config.deviceEndpoint),
      public: this.createClient(config, config.publicEndpoint),
      server: this.createClient(config, config.serverEndpoint ?? config.publicEndpoint),
    };
  }

  async getSignedUrlForUpload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    await this.ensureBucketExists();
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      ContentType: options.contentType,
      Key: options.key,
    });

    const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
    const client = this.resolveClient(options.accessTarget);
    const url = await getSignedUrl(client, command, { expiresIn });

    return {
      bucket: this.bucketName,
      expiresAt: new Date(Date.now() + expiresIn * MILLISECONDS_IN_SECOND).toISOString(),
      headers: {},
      method: 'PUT',
      objectKey: options.key,
      provider: this.providerName,
      url,
    };
  }

  async getSignedUrlForDownload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    await this.ensureBucketExists();
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: options.key,
    });

    const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
    const client = this.resolveClient(options.accessTarget);
    const url = await getSignedUrl(client, command, { expiresIn });

    return {
      bucket: this.bucketName,
      expiresAt: new Date(Date.now() + expiresIn * MILLISECONDS_IN_SECOND).toISOString(),
      headers: {},
      method: 'GET',
      objectKey: options.key,
      provider: this.providerName,
      url,
    };
  }

  async upload(options: UploadOptions): Promise<void> {
    await this.ensureBucketExists();
    await this.clients.server.send(
      new PutObjectCommand({
        Body: options.data,
        Bucket: this.bucketName,
        ContentType: options.contentType ?? 'application/octet-stream',
        Key: options.key,
        Metadata: options.metadata,
      }),
    );
  }

  async download(options: DownloadOptions): Promise<string> {
    await this.ensureBucketExists();
    try {
      const response = await this.clients.server.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: options.key,
        }),
      );

      if (response.Body === undefined) {
        throw new Error(`Object body is empty for key: ${options.key}`);
      }

      return await response.Body.transformToString();
    } catch (error: unknown) {
      if (error instanceof Error) {
        const nextError = error as Error & Partial<{ $metadata?: { httpStatusCode?: number } }>;
        if (error.name === 'NoSuchKey' || nextError.$metadata?.httpStatusCode === HTTP_NOT_FOUND) {
          throw new Error(`Object not found: ${options.key}`, { cause: error });
        }
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureBucketExists();
    try {
      await this.clients.server.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof Error) {
        const nextError = error as Error & Partial<{ $metadata?: { httpStatusCode?: number } }>;
        if (error.name === 'NotFound' || nextError.$metadata?.httpStatusCode === HTTP_NOT_FOUND) {
          return false;
        }
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucketExists();
    await this.clients.server.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }

  async deleteMultiple(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    await this.ensureBucketExists();
    await this.clients.server.send(
      new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: {
          Objects: keys.map((key) => ({ Key: key })),
        },
      }),
    );
  }

  async list(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    const objects = await this.listObjects(prefix, maxKeys);
    return objects.map((object) => object.key);
  }

  async listObjects(prefix?: string, maxKeys: number = 1000): Promise<StorageObjectSummary[]> {
    await this.ensureBucketExists();
    const response = await this.clients.server.send(
      new ListObjectsV2Command({
        Bucket: this.bucketName,
        MaxKeys: maxKeys,
        Prefix: prefix,
      }),
    );

    return (
      response.Contents?.map((object) => ({
        key: object.Key ?? '',
        sizeBytes: object.Size === undefined ? undefined : Number(object.Size),
        updatedAt: object.LastModified?.toISOString(),
      })).filter((object) => object.key !== '') ?? []
    );
  }

  getProviderName(): StorageProviderName {
    return this.providerName;
  }

  private createClient(config: S3CompatibleConfig, endpoint?: string): S3Client {
    return new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
    });
  }

  private async ensureBucketExists(): Promise<void> {
    if (!this.ensureBucketExistsEnabled) {
      return;
    }

    this.ensureBucketExistsPromise ??= this.ensureBucketExistsInternal();
    try {
      await this.ensureBucketExistsPromise;
    } catch (error) {
      this.ensureBucketExistsPromise = null;
      throw error;
    }
  }

  private async ensureBucketExistsInternal(): Promise<void> {
    try {
      await this.clients.server.send(
        new HeadBucketCommand({
          Bucket: this.bucketName,
        }),
      );
      return;
    } catch (error: unknown) {
      if (!this.isMissingBucketError(error)) {
        throw error;
      }
    }

    try {
      await this.clients.server.send(
        new CreateBucketCommand({
          Bucket: this.bucketName,
        }),
      );
    } catch (error: unknown) {
      if (this.isBucketAlreadyExistsError(error)) {
        return;
      }
      throw error;
    }
  }

  private isBucketAlreadyExistsError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === 'BucketAlreadyExists' || error.name === 'BucketAlreadyOwnedByYou';
  }

  private isMissingBucketError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const nextError = error as Error & Partial<{ $metadata?: { httpStatusCode?: number } }>;
    return (
      error.name === 'NoSuchBucket' ||
      error.name === 'NotFound' ||
      nextError.$metadata?.httpStatusCode === HTTP_NOT_FOUND ||
      nextError.$metadata?.httpStatusCode === HTTP_FORBIDDEN
    );
  }

  private resolveClient(accessTarget: StorageAccessTarget | undefined): S3Client {
    if (accessTarget === 'device') {
      return this.clients.device;
    }
    if (accessTarget === 'public') {
      return this.clients.public;
    }
    return this.clients.server;
  }
}
