'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let clientQueryClientSingleton: QueryClient | undefined;

const getQueryClient = (): QueryClient => {
  clientQueryClientSingleton ??= new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
      },
    },
  });

  return clientQueryClientSingleton;
};

type DeviceQueryProviderProps = Readonly<{
  children: React.ReactNode;
}>;

export const DeviceQueryProvider = ({ children }: DeviceQueryProviderProps) => (
  <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>
);
