import { httpBatchLink, httpSubscriptionLink, loggerLink, splitLink } from '@trpc/client';
import { SuperJSON } from 'superjson';

/**
 * Creates the TRPC link chain for client-server communication.
 *
 * Includes a logger link (development only), and a split link that routes
 * subscriptions through SSE and regular queries/mutations through batched HTTP.
 * Uses SuperJSON for serialization and tags HTTP requests with
 * `x-trpc-source: nextjs-react`, which downstream servers can use for diagnostics.
 *
 * @param baseUrl - The base URL for the API server.
 * @param endpoint - The TRPC endpoint path appended to `baseUrl` for both HTTP and
 * subscription traffic.
 * @returns An array of TRPC links.
 */
export const createTRPCLinks = (baseUrl: string, endpoint: string) => [
  loggerLink({
    enabled: (op) =>
      process.env.NODE_ENV === 'development' ||
      (op.direction === 'down' && op.result instanceof Error),
  }),
  splitLink({
    condition: (op) => op.type === 'subscription',
    true: httpSubscriptionLink({
      transformer: SuperJSON,
      url: `${baseUrl}${endpoint}`,
    }),
    false: httpBatchLink({
      transformer: SuperJSON,
      url: `${baseUrl}${endpoint}`,
      headers: () => {
        const headers = new Headers();
        headers.set('x-trpc-source', 'nextjs-react');
        return headers;
      },
    }),
  }),
];
