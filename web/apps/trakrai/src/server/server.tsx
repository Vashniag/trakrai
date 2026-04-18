// eslint-disable-next-line import/no-unassigned-import
import 'server-only';

import { cache } from 'react';

import { headers } from 'next/headers';

import {
  type DefaultError,
  dehydrate,
  type FetchQueryOptions,
  HydrationBoundary,
  type QueryKey,
} from '@tanstack/react-query';
import { appRouter } from '@trakrai/backend/server/routers';
import {
  createTRPCOptionsProxy,
  type ResolverDef,
  type TRPCQueryOptions,
} from '@trpc/tanstack-react-query';

import { createTRPCContext } from '@/server/trpc';
import { createQueryClient } from '@/server/utils';

const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set('x-trpc-source', 'rsc');
  return createTRPCContext({
    headers: heads,
    setHeader: async () => {},
  });
});

const getQueryClient = cache(createQueryClient);

const trpc = createTRPCOptionsProxy({
  ctx: createContext,
  router: appRouter,
  queryClient: getQueryClient,
});

export const HydrateClient = (props: { children: React.ReactNode }) => {
  const queryClient = getQueryClient();
  return <HydrationBoundary state={dehydrate(queryClient)}>{props.children}</HydrationBoundary>;
};

export const prefetch = <S extends ResolverDef, T extends ReturnType<TRPCQueryOptions<S>>>(
  queryOptions: (trpcInstance: typeof trpc) => T,
) => {
  const queryClient = getQueryClient();
  const options = queryOptions(trpc);
  if (options.queryKey[1]?.type === 'infinite') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    void queryClient.prefetchInfiniteQuery(options as any);
  } else {
    void queryClient.prefetchQuery(options);
  }
};

export const fetchQuery = <
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = never,
>(
  queryOptions: (
    trpcInstance: typeof trpc,
  ) => FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
): Promise<TData> => {
  const queryClient = getQueryClient();
  const options = queryOptions(trpc);
  return queryClient.fetchQuery(options);
};
