import { appRouter } from '@trakrai/backend/server/routers';
import { createOpenApiFetchHandler } from 'trpc-to-openapi';

import { applyCorsHeaders, createCorsPreflightResponse } from '@/lib/cors';
import { setCookieHeader } from '@/lib/set-cookie-header';
import { createTRPCContextNext } from '@/server/trpc';

const handler = async (req: Request) =>
  applyCorsHeaders(
    req,
    await createOpenApiFetchHandler({
      endpoint: '/api/external',
      router: appRouter,
      createContext: (opts) =>
        createTRPCContextNext(opts, (key, value) => setCookieHeader(key, value, opts.resHeaders)),
      req,
    }),
  );

const optionsHandler = (req: Request) => createCorsPreflightResponse(req);

export {
  handler as GET,
  handler as HEAD,
  optionsHandler as OPTIONS,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
