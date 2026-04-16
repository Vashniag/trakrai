'use client';

import { useState } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';

import type { CloudPackageApiRouter } from '@trakrai/cloud-api-contract/lib/package-artifacts';
import type { RuntimeManagerPackageCatalogState } from '@trakrai/runtime-manager-ui/components/runtime-manager-panel';

const DEFAULT_CLOUD_API_URL = 'http://localhost:3000';

const trimTrailingSlash = (value: string): string => value.replace(/\/$/, '');

const resolveCloudApiBaseUrl = (): string => {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_TRAKRAI_CLOUD_API_URL?.trim();
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== '') {
    return trimTrailingSlash(configuredBaseUrl);
  }

  return DEFAULT_CLOUD_API_URL;
};

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
      },
    },
  });

const cloudPackageApi = createTRPCReact<CloudPackageApiRouter>();

let clientQueryClientSingleton: QueryClient | undefined;

const getQueryClient = (): QueryClient => {
  clientQueryClientSingleton ??= createQueryClient();
  return clientQueryClientSingleton;
};

type CloudPackageApiProviderProps = Readonly<{
  baseUrl?: string;
  children: React.ReactNode;
}>;

export const CloudPackageApiProvider = ({ baseUrl, children }: CloudPackageApiProviderProps) => {
  const queryClient = getQueryClient();
  const resolvedBaseUrl = trimTrailingSlash(baseUrl ?? resolveCloudApiBaseUrl());
  const [trpcClient] = useState(() =>
    cloudPackageApi.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === 'development' ||
            (op.direction === 'down' && op.result instanceof Error),
        }),
        httpBatchLink({
          headers: () => {
            const headers = new Headers();
            headers.set('x-trpc-source', 'trakrai-device-runtime');
            return headers;
          },
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
