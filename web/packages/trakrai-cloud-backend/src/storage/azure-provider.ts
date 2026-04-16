import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';

import type {
  DownloadOptions,
  SignedUrlOptions,
  StorageObjectSummary,
  StorageProvider,
  StorageProviderName,
  StorageSignedRequest,
  UploadOptions,
} from './interface';

type AzureBlobStorageConfig = {
  accountKey: string;
  accountName: string;
  containerName: string;
};

const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 3600;
const MILLISECONDS_IN_SECOND = 1000;

export class AzureBlobStorageProvider implements StorageProvider {
  private readonly accountName: string;
  private readonly containerName: string;
  private readonly providerName: StorageProviderName = 'AZURE';
  private readonly serviceClient: BlobServiceClient;
  private readonly sharedKeyCredential: StorageSharedKeyCredential;

  constructor(config: AzureBlobStorageConfig) {
    this.accountName = config.accountName;
    this.containerName = config.containerName;
    this.sharedKeyCredential = new StorageSharedKeyCredential(
      config.accountName,
      config.accountKey,
    );
    this.serviceClient = new BlobServiceClient(
      `https://${config.accountName}.blob.core.windows.net`,
      this.sharedKeyCredential,
    );
  }

  async getSignedUrlForUpload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
    const expiresOn = new Date(Date.now() + expiresIn * MILLISECONDS_IN_SECOND);
    const sas = generateBlobSASQueryParameters(
      {
        blobName: options.key,
        containerName: this.containerName,
        expiresOn,
        permissions: BlobSASPermissions.parse('cw'),
        protocol: SASProtocol.Https,
      },
      this.sharedKeyCredential,
    );

    return {
      bucket: this.containerName,
      expiresAt: expiresOn.toISOString(),
      headers: {
        'x-ms-blob-type': 'BlockBlob',
      },
      method: 'PUT',
      objectKey: options.key,
      provider: this.providerName,
      url: `https://${this.accountName}.blob.core.windows.net/${this.containerName}/${options.key}?${sas.toString()}`,
    };
  }

  async getSignedUrlForDownload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
    const expiresOn = new Date(Date.now() + expiresIn * MILLISECONDS_IN_SECOND);
    const sas = generateBlobSASQueryParameters(
      {
        blobName: options.key,
        containerName: this.containerName,
        expiresOn,
        permissions: BlobSASPermissions.parse('r'),
        protocol: SASProtocol.Https,
      },
      this.sharedKeyCredential,
    );

    return {
      bucket: this.containerName,
      expiresAt: expiresOn.toISOString(),
      headers: {},
      method: 'GET',
      objectKey: options.key,
      provider: this.providerName,
      url: `https://${this.accountName}.blob.core.windows.net/${this.containerName}/${options.key}?${sas.toString()}`,
    };
  }

  async upload(options: UploadOptions): Promise<void> {
    const containerClient = this.serviceClient.getContainerClient(this.containerName);
    const blobClient = containerClient.getBlockBlobClient(options.key);
    const data = typeof options.data === 'string' ? Buffer.from(options.data) : options.data;
    await blobClient.upload(data, data.byteLength, {
      blobHTTPHeaders: {
        blobContentType: options.contentType ?? 'application/octet-stream',
      },
      metadata: options.metadata,
    });
  }

  async download(options: DownloadOptions): Promise<string> {
    const containerClient = this.serviceClient.getContainerClient(this.containerName);
    const blobClient = containerClient.getBlobClient(options.key);
    const response = await blobClient.download();
    const responseBody = response.readableStreamBody;
    if (responseBody === undefined) {
      throw new Error(`Object body is empty for key: ${options.key}`);
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of responseBody) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  async exists(key: string): Promise<boolean> {
    const containerClient = this.serviceClient.getContainerClient(this.containerName);
    return containerClient.getBlobClient(key).exists();
  }

  async delete(key: string): Promise<void> {
    const containerClient = this.serviceClient.getContainerClient(this.containerName);
    await containerClient.deleteBlob(key);
  }

  async deleteMultiple(keys: string[]): Promise<void> {
    await Promise.all(keys.map(async (key) => this.delete(key)));
  }

  async list(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    const objects = await this.listObjects(prefix, maxKeys);
    return objects.map((object) => object.key);
  }

  async listObjects(prefix?: string, maxKeys: number = 1000): Promise<StorageObjectSummary[]> {
    const containerClient = this.serviceClient.getContainerClient(this.containerName);
    const iterator = containerClient.listBlobsFlat({
      prefix,
    });
    const objects: StorageObjectSummary[] = [];
    for await (const blob of iterator) {
      if (objects.length >= maxKeys) {
        break;
      }
      if (blob.name === '') {
        continue;
      }
      objects.push({
        key: blob.name,
        sizeBytes: blob.properties.contentLength,
        updatedAt: blob.properties.lastModified.toISOString(),
      });
    }

    return objects;
  }

  getProviderName(): StorageProviderName {
    return this.providerName;
  }
}
