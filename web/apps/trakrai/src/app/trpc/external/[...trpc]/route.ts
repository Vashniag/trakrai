import { createOpenApiFetchHandler } from 'trpc-to-openapi';

import { setCookieHeader } from '@/lib/set-cookie-header';
import { appRouter } from '@/server/routers';
import { createTRPCContextNext } from '@/server/trpc';

const handler = (req: Request) =>
  createOpenApiFetchHandler({
    endpoint: '/trpc/external',
    router: appRouter,
    createContext: (opts) =>
      createTRPCContextNext(opts, (key, value) => setCookieHeader(key, value, opts.resHeaders)),
    req,
  });

export {
  handler as DELETE,
  handler as GET,
  handler as HEAD,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
