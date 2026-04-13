import { defaultShouldDehydrateQuery, QueryClient } from '@tanstack/react-query';
import { loggerLink, splitLink, httpSubscriptionLink, httpBatchLink } from '@trpc/client';
import { SuperJSON } from 'superjson';

import { MILLISECONDS_IN_SECONDS, SECONDS_IN_MINUTE } from '@/lib/constants';
import { getBaseUrl } from '@/lib/getBaseUrl';

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: SECONDS_IN_MINUTE * MILLISECONDS_IN_SECONDS,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query): boolean =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });

export const links = [
  loggerLink({
    enabled: (op) =>
      process.env.NODE_ENV === 'development' ||
      (op.direction === 'down' && op.result instanceof Error),
  }),
  splitLink({
    condition: (op) => op.type === 'subscription',
    true: httpSubscriptionLink({
      transformer: SuperJSON,
      url: `/api/trpc`,
    }),
    false: httpBatchLink({
      transformer: SuperJSON,
      url: `${getBaseUrl()}/api/trpc`,
      headers: () => {
        const headers = new Headers();
        headers.set('x-trpc-source', 'nextjs-react');

        return headers;
      },
    }),
  }),
];
