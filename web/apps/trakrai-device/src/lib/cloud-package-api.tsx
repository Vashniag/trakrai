'use client';

import { useState } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';

import type { AppRouter } from '@trakrai/backend/server/routers';
import type { RuntimeManagerPackageCatalogState } from '@trakrai/runtime-manager-ui/components/runtime-manager-panel';

const trimTrailingSlash = (value: string): string => value.replace(/\/$/, '');

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
      },
    },
  });

const cloudPackageApi = createTRPCReact<AppRouter>();

let clientQueryClientSingleton: QueryClient | undefined;

const getQueryClient = (): QueryClient => {
  clientQueryClientSingleton ??= createQueryClient();
  return clientQueryClientSingleton;
};

type CloudPackageApiProviderProps = Readonly<{
  baseUrl: string;
  children: React.ReactNode;
  enableLogger?: boolean;
}>;

export const CloudPackageApiProvider = ({
  baseUrl,
  children,
  enableLogger = false,
}: CloudPackageApiProviderProps) => {
  const queryClient = getQueryClient();
  const resolvedBaseUrl = trimTrailingSlash(baseUrl);
  const [trpcClient] = useState(() =>
    cloudPackageApi.createClient({
      links: [
        loggerLink({
          enabled: (op) => enableLogger || (op.direction === 'down' && op.result instanceof Error),
        }),
        httpBatchLink({
          headers: () => {
            const headers = new Headers();
            headers.set('x-trpc-source', 'trakrai-device-runtime');
            return headers;
          },
          transformer: superjson,
          url: `${resolvedBaseUrl}/api/trpc`,
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <cloudPackageApi.Provider client={trpcClient} queryClient={queryClient}>
        {children}
      </cloudPackageApi.Provider>
    </QueryClientProvider>
  );
};

export const useCloudPackageCatalog = (): RuntimeManagerPackageCatalogState => {
  const packageCatalogQuery = cloudPackageApi.packageArtifacts.listAvailable.useQuery({});

  return {
    artifacts: packageCatalogQuery.data?.artifacts ?? [],
    error: packageCatalogQuery.error instanceof Error ? packageCatalogQuery.error.message : null,
    isLoading: packageCatalogQuery.isLoading,
  };
};
