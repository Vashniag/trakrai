import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

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

const unreachable = () => {
  throw new Error('Cloud API contract routers are type-only and cannot be executed directly.');
};

export const cloudPackageApiRouter = t.router({
  packageArtifacts: t.router({
    createDeviceDownloadSession: t.procedure
      .input(deviceArtifactSessionInputSchema.pick({ deviceId: true, path: true }))
      .output(storageSignedRequestSchema)
      .mutation(unreachable),
    createDeviceUploadSession: t.procedure
      .input(deviceArtifactSessionInputSchema)
      .output(storageSignedRequestSchema)
      .mutation(unreachable),
    createPackageDownloadSession: t.procedure
      .input(packageArtifactSessionInputSchema.pick({ path: true }))
      .output(storageSignedRequestSchema)
      .mutation(unreachable),
    createPackageUploadSession: t.procedure
      .input(packageArtifactSessionInputSchema)
      .output(storageSignedRequestSchema)
      .mutation(unreachable),
    listAvailable: t.procedure
      .input(listPackageArtifactsInputSchema)
      .output(listPackageArtifactsOutputSchema)
      .query(unreachable),
  }),
});

export type CloudPackageApiRouter = typeof cloudPackageApiRouter;
export type AvailablePackageArtifact = z.infer<typeof availablePackageArtifactSchema>;
export type DeviceArtifactSessionInput = z.infer<typeof deviceArtifactSessionInputSchema>;
export type ListPackageArtifactsInput = z.infer<typeof listPackageArtifactsInputSchema>;
export type ListPackageArtifactsOutput = z.infer<typeof listPackageArtifactsOutputSchema>;
export type PackageArtifactSessionInput = z.infer<typeof packageArtifactSessionInputSchema>;
export type StorageSignedRequest = z.infer<typeof storageSignedRequestSchema>;
