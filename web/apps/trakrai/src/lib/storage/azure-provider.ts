import {
  BlobServiceClient,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
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

type AzureConfig = {
  accountKey: string;
  accountName: string;
  containerName: string;
};

type AzureBlobDownloadResponse = {
  readableStreamBody?: AsyncIterable<Uint8Array>;
};

type AzureBlobClientAdapter = {
  deleteIfExists: () => Promise<void>;
  download: () => Promise<AzureBlobDownloadResponse>;
  exists: () => Promise<boolean>;
  url: string;
};

type AzureBlockBlobClientAdapter = {
  upload: (
    body: Uint8Array | Buffer,
    length: number,
    options: {
      blobHTTPHeaders: {
        blobContentType: string;
      };
      metadata?: Record<string, string>;
    },
  ) => Promise<void>;
};

type AzureBlobItemAdapter = {
  name: string;
  properties: {
    contentLength?: number;
    lastModified?: Date;
  };
};

type AzureContainerClientAdapter = {
  getBlobClient: (key: string) => AzureBlobClientAdapter;
  getBlockBlobClient: (key: string) => AzureBlockBlobClientAdapter;
  listBlobsFlat: (options?: { prefix: string }) => AsyncIterable<AzureBlobItemAdapter>;
};

const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 3600;

export class AzureBlobStorageProvider implements StorageProvider {
  private readonly containerClient: AzureContainerClientAdapter;
  private readonly containerName: string;
  private readonly sharedKeyCredential: StorageSharedKeyCredential;

  constructor(config: AzureConfig) {
    this.containerName = config.containerName;
    this.sharedKeyCredential = new StorageSharedKeyCredential(
      config.accountName,
      config.accountKey,
    );
    const blobServiceClient = new BlobServiceClient(
      `https://${config.accountName}.blob.core.windows.net`,
      this.sharedKeyCredential,
    );
    this.containerClient = blobServiceClient.getContainerClient(
      config.containerName,
    ) as unknown as AzureContainerClientAdapter;
  }

  async getSignedUrlForUpload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    const expiresOn = new Date();
    expiresOn.setSeconds(
      expiresOn.getSeconds() + (options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS),
    );
    const blobClient = this.getBlobClient(options.key);
    const sasToken = generateBlobSASQueryParameters(
      {
        blobName: options.key,
        containerName: this.containerName,
        expiresOn,
        permissions: BlobSASPermissions.parse('cw'),
      },
      this.sharedKeyCredential,
    ).toString();

    return {
      bucket: this.containerName,
      expiresAt: expiresOn.toISOString(),
      headers: {},
      method: 'PUT',
      objectKey: options.key,
      provider: 'AZURE',
      url: `${blobClient.url}?${sasToken}`,
    };
  }

  async getSignedUrlForDownload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    const expiresOn = new Date();
    expiresOn.setSeconds(
      expiresOn.getSeconds() + (options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS),
    );
    const blobClient = this.getBlobClient(options.key);
    const sasToken = generateBlobSASQueryParameters(
      {
        blobName: options.key,
        containerName: this.containerName,
        expiresOn,
        permissions: BlobSASPermissions.parse('r'),
      },
      this.sharedKeyCredential,
    ).toString();

    return {
      bucket: this.containerName,
      expiresAt: expiresOn.toISOString(),
      headers: {},
      method: 'GET',
      objectKey: options.key,
      provider: 'AZURE',
      url: `${blobClient.url}?${sasToken}`,
    };
  }

  async upload(options: UploadOptions): Promise<void> {
    const blockBlobClient = this.getBlockBlobClient(options.key);
    const body = typeof options.data === 'string' ? Buffer.from(options.data) : options.data;

    await blockBlobClient.upload(body, body.length, {
      blobHTTPHeaders: {
        blobContentType: options.contentType ?? 'application/octet-stream',
      },
      metadata: options.metadata,
    });
  }

  async download(options: DownloadOptions): Promise<string> {
    const blobClient = this.getBlobClient(options.key);
    const response = await blobClient.download();

    if (response.readableStreamBody === undefined) {
      throw new Error(`Blob body is empty for key: ${options.key}`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of response.readableStreamBody as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf-8');
  }

  async exists(key: string): Promise<boolean> {
    return this.getBlobClient(key).exists();
  }

  async delete(key: string): Promise<void> {
    await this.getBlobClient(key).deleteIfExists();
  }

  async deleteMultiple(keys: string[]): Promise<void> {
    await Promise.all(keys.map(async (key) => this.delete(key)));
  }

  async list(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    const objects = await this.listObjects(prefix, maxKeys);
    return objects.map((object) => object.key);
  }

  async listObjects(prefix?: string, maxKeys: number = 1000): Promise<StorageObjectSummary[]> {
    const objects: StorageObjectSummary[] = [];
    let count = 0;
    for await (const blob of this.listBlobItems(prefix)) {
      if (count >= maxKeys) {
        break;
      }
      objects.push({
        key: blob.name,
        sizeBytes: blob.properties.contentLength,
        updatedAt:
          blob.properties.lastModified === undefined
            ? undefined
            : blob.properties.lastModified.toISOString(),
      });
      count += 1;
    }
    return objects;
  }

  getProviderName(): StorageProviderName {
    return 'AZURE';
  }

  private getBlobClient(key: string): AzureBlobClientAdapter {
    return this.containerClient.getBlobClient(key);
  }

  private getBlockBlobClient(key: string): AzureBlockBlobClientAdapter {
    return this.containerClient.getBlockBlobClient(key);
  }

  private listBlobItems(prefix?: string): AsyncIterable<AzureBlobItemAdapter> {
    const options = prefix === undefined || prefix === '' ? undefined : { prefix };
    return this.containerClient.listBlobsFlat(options);
  }
}
