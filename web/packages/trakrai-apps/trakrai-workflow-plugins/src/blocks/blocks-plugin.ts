import { defineTrpcPlugin, type ApiRequestContext, type ApiHooks } from '@trakrai-workflow/core';
import { z } from 'zod';

import { type FluxeryBlockTemplate } from './block-utils';

const blockIdSchema = z.string().min(1);

/**
 * Lightweight block library record shown in block pickers before the full template is fetched.
 */
export type FluxeryBlockLibraryItem = {
  blockId: string;
  name: string;
  updatedAt: string | null;
};

type BlocksPluginHandlers = {
  getBlockDefinition: (params: {
    blockId: string;
    ctx: ApiRequestContext;
  }) => Promise<FluxeryBlockTemplate>;
  getUploadUrl: (params: {
    blockId?: string;
    ctx: ApiRequestContext;
  }) => Promise<{ blockId: string; uploadUrl: string }>;
  listBlocks: (params: { ctx: ApiRequestContext }) => Promise<FluxeryBlockLibraryItem[]>;
};

/**
 * Creates the tRPC plugin that backs the reusable block library UI.
 *
 * Host apps own persistence for block templates and uploads; the callbacks bridge the editor to
 * those storage concerns without hard-coding a backend.
 */
export const blocksPlugin = (handlers: BlocksPluginHandlers, hooks?: ApiHooks<ApiRequestContext>) =>
  defineTrpcPlugin({
    name: 'blocks',
    hooks,
    createRouter: ({ router, procedure }) =>
      router({
        getBlockDefinition: procedure
          .input(
            z.object({
              blockId: blockIdSchema,
            }),
          )
          .query(({ ctx, input }) => handlers.getBlockDefinition({ blockId: input.blockId, ctx })),
        getUploadUrl: procedure
          .input(
            z.object({
              blockId: blockIdSchema.optional(),
            }),
          )
          .mutation(({ ctx, input }) => handlers.getUploadUrl({ blockId: input.blockId, ctx })),
        listBlocks: procedure.query(({ ctx }) => handlers.listBlocks({ ctx })),
      }),
  });

export type BlocksPlugin = ReturnType<typeof blocksPlugin>;
