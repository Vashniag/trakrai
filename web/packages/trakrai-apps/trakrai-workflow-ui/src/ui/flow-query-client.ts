import { defaultShouldDehydrateQuery, QueryClient } from '@tanstack/react-query';
import { SuperJSON } from 'superjson';

const ONE_MINUTE_IN_MS = 60_000;

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: ONE_MINUTE_IN_MS,
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

let clientQueryClientSingleton: QueryClient | undefined;

/**
 * Returns a singleton `QueryClient` on the client side, or a new instance on the server.
 *
 * Configured with 1-minute stale time and SuperJSON serialization for
 * hydration/dehydration support. Pending queries are also dehydrated so provider
 * trees can stream or hydrate in-flight plugin requests without dropping them.
 *
 * The browser reuses one shared instance to avoid resetting caches between renders,
 * while server calls receive a fresh client per request boundary.
 */
export const getQueryClient = (): QueryClient => {
  if (typeof window === 'undefined') {
    return createQueryClient();
  }

  clientQueryClientSingleton ??= createQueryClient();
  return clientQueryClientSingleton;
};
