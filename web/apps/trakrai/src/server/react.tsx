'use client';

import { useState } from 'react';

import {
  QueryClientProvider,
  type QueryKey,
  useQueryClient,
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQuery,
  type UseQueryOptions,
  type DefaultError,
} from '@tanstack/react-query';
import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';
import { createTRPCContext } from '@trpc/tanstack-react-query';

import { createQueryClient, links } from '@/server/utils';

import type { AppRouter } from '@trakrai/backend/server/routers';

const { useTRPC, TRPCProvider } = createTRPCContext<AppRouter>();

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = (): QueryClient => {
  if (typeof window === 'undefined') {
    return createQueryClient();
  }
  clientQueryClientSingleton ??= createQueryClient();
  return clientQueryClientSingleton;
};

export const api: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();

export const TRPCReactProvider = (props: { readonly children: React.ReactNode }) => {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    api.createClient({
      links,
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        <api.Provider client={trpcClient} queryClient={queryClient}>
          {props.children}
        </api.Provider>
      </TRPCProvider>
    </QueryClientProvider>
  );
};

export const useInvalidateQuery = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  return async (
    queryFn: (apiInstance: typeof trpc) => {
      queryKey: () => QueryKey;
    },
  ) => {
    const queryKey = queryFn(trpc).queryKey();
    await queryClient.invalidateQueries({
      queryKey,
    });
  };
};

export const useTRPCMutation = <
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  options: (
    api: ReturnType<typeof useTRPC>,
  ) => UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
) => {
  const trpc = useTRPC();
  const mutationOptions = options(trpc);
  return useMutation(mutationOptions);
};

export const useTRPCQuery = <
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: (
    api: ReturnType<typeof useTRPC>,
  ) => UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
) => {
  const trpc = useTRPC();
  const queryOptions = options(trpc);
  return useQuery(queryOptions);
};
