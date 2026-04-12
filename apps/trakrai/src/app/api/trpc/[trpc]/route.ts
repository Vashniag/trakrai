import { type FetchCreateContextFnOptions, fetchRequestHandler } from '@trpc/server/adapters/fetch';

import logger from '@/lib/logger';
import { withRequestContext } from '@/lib/request-context';
import { setCookieHeader } from '@/lib/set-cookie-header';
import { appRouter } from '@/server/routers';
import { createTRPCContext } from '@/server/trpc';

const createContext = (req: Request, opts: FetchCreateContextFnOptions) => {
  return createTRPCContext({
    headers: req.headers,
    setHeader: (key, value) => setCookieHeader(key, value, opts.resHeaders),
  });
};

const handler = withRequestContext((req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: (opts) => createContext(req, opts),
    onError: ({ path, error }) => {
      logger.error(`tRPC failed on ${path ?? '<no-path>'}: ${error.message}`);
    },
  }),
);

export { handler as GET, handler as POST };
