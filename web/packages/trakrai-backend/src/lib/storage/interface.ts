export type StorageAccessTarget = 'device' | 'public';
export type StorageProviderName = 'AZURE' | 'MINIO' | 'S3';

export interface SignedUrlOptions {
  accessTarget?: StorageAccessTarget;
  contentType?: string;
  expiresIn?: number;
  key: string;
}

export interface UploadOptions {
  contentType?: string;
  data: string | Buffer;
  key: string;
  metadata?: Record<string, string>;
}

export interface DownloadOptions {
  key: string;
}

export interface StorageObjectSummary {
  key: string;
  sizeBytes?: number;
  updatedAt?: string;
}

export interface StorageSignedRequest {
  bucket?: string;
  expiresAt?: string;
  headers: Record<string, string>;
  method: 'GET' | 'PUT';
  objectKey?: string;
  provider: StorageProviderName;
  url: string;
}

export interface StorageProvider {
  delete(key: string): Promise<void>;
  deleteMultiple(keys: string[]): Promise<void>;
  download(options: DownloadOptions): Promise<string>;
  exists(key: string): Promise<boolean>;
  getProviderName(): StorageProviderName;
  getSignedUrlForDownload(options: SignedUrlOptions): Promise<StorageSignedRequest>;
  getSignedUrlForUpload(options: SignedUrlOptions): Promise<StorageSignedRequest>;
  list(prefix?: string, maxKeys?: number): Promise<string[]>;
  listObjects(prefix?: string, maxKeys?: number): Promise<StorageObjectSummary[]>;
  upload(options: UploadOptions): Promise<void>;
}
