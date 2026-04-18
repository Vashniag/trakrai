import { defineHttpPlugin } from '@trakrai-workflow/core';
import { serve } from 'inngest/next';

import type { Inngest, InngestFunction } from 'inngest';

/**
 * Exposes an Inngest serve endpoint through Fluxery's HTTP plugin system.
 *
 * The plugin always mounts at `/inngest` and forwards `GET`, `PUT`, and `POST`
 * requests to the handlers returned by `inngest/next`.
 *
 * @param inngest - The Inngest client that owns the registered functions.
 * @param functions - Inngest functions to serve from the mounted route.
 * @returns A Fluxery HTTP plugin that can be composed into the host API handler.
 */
export const inngestPlugin = (inngest: Inngest.Like, functions: InngestFunction.Like[]) => {
  const handler = serve({
    client: inngest,
    functions,
  });
  type NextHandlerRequest = Parameters<typeof handler.GET>[0];

  return defineHttpPlugin({
    path: '/inngest',
    handler: {
      GET: (request) => handler.GET(request as NextHandlerRequest, undefined),
      PUT: (request) => handler.PUT(request as NextHandlerRequest, undefined),
      POST: (request) => handler.POST(request as NextHandlerRequest, undefined),
    },
  });
};
