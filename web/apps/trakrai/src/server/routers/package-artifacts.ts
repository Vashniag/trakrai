import {
  deviceArtifactSessionInputSchema,
  listPackageArtifactsInputSchema,
  listPackageArtifactsOutputSchema,
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
import { createTRPCRouter, publicProcedure } from '@/server/trpc';

export const packageArtifactsRouter = createTRPCRouter({
  createDeviceDownloadSession: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/devices/download-session',
      },
    })
    .input(deviceArtifactSessionInputSchema.pick({ deviceId: true, path: true }))
    .output(storageSignedRequestSchema)
    .mutation(({ ctx, input }) => createDeviceDownloadSession(input, ctx.headers)),
  createDeviceUploadSession: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/devices/upload-session',
      },
    })
    .input(deviceArtifactSessionInputSchema)
    .output(storageSignedRequestSchema)
    .mutation(({ ctx, input }) => createDeviceUploadSession(input, ctx.headers)),
  createPackageDownloadSession: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/storage/packages/download-session',
      },
    })
    .input(packageArtifactSessionInputSchema.pick({ path: true }))
    .output(storageSignedRequestSchema)
    .mutation(({ ctx, input }) => createPackageDownloadSession(input, ctx.headers)),
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
