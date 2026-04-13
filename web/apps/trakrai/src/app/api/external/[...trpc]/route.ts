import { createOpenApiFetchHandler } from 'trpc-to-openapi';

import { setCookieHeader } from '@/lib/set-cookie-header';
import { appRouter } from '@/server/routers';
import { createTRPCContextNext } from '@/server/trpc';

const handler = (req: Request) =>
  createOpenApiFetchHandler({
    endpoint: '/api/external',
    router: appRouter,
    createContext: (opts) =>
      createTRPCContextNext(opts, (key, value) => setCookieHeader(key, value, opts.resHeaders)),
    req,
  });

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
  handler as HEAD,
};
