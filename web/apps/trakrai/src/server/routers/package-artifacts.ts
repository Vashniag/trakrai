import {
  deviceArtifactSessionInputSchema,
  listPackageArtifactsInputSchema,
  listPackageArtifactsOutputSchema,
  packageArtifactDeviceDownloadSessionInputSchema,
  packageArtifactSessionInputSchema,
  storageSignedRequestSchema,
} from '@trakrai/cloud-api-contract/lib/package-artifacts';

import {
  createDeviceDownloadSession,
  createDeviceUploadSession,
  createPackageDownloadSession,
  createPackageUploadSession,
  listAvailablePackageArtifacts,
} from '@/server/package-artifacts';
import { createTRPCRouter, deviceProcedure, publicProcedure } from '@/server/trpc';

export const packageArtifactsRouter = createTRPCRouter({
  createDeviceDownloadSession: deviceProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/devices/download-session',
      },
    })
    .input(deviceArtifactSessionInputSchema.pick({ deviceId: true, path: true }))
    .output(storageSignedRequestSchema)
    .mutation(({ input }) => createDeviceDownloadSession(input)),
  createDeviceUploadSession: deviceProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/devices/upload-session',
      },
    })
    .input(deviceArtifactSessionInputSchema)
    .output(storageSignedRequestSchema)
    .mutation(({ input }) => createDeviceUploadSession(input)),
  createPackageDownloadSession: deviceProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/packages/download-session',
      },
    })
    .input(packageArtifactDeviceDownloadSessionInputSchema)
    .output(storageSignedRequestSchema)
    .mutation(({ input }) => createPackageDownloadSession(input)),
  createPackageUploadSession: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/packages/upload-session',
      },
    })
    .input(packageArtifactSessionInputSchema)
    .output(storageSignedRequestSchema)
    .mutation(({ ctx, input }) => createPackageUploadSession(input, ctx.headers)),
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
      artifacts: await listAvailablePackageArtifacts(input.serviceName),
    })),
});
