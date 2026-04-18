'use client';

import { createContext, useContext, useState } from 'react';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import {
  type TRPCClient,
  type InferTrpcPluginName,
  type InferTrpcPluginRouter,
  type TrpcApiPlugin,
} from '@trakrai-workflow/core';
import { createTRPCClient } from '@trpc/client';
import {
  createTRPCContext,
  type DefaultFeatureFlags,
  type TRPCOptionsProxy,
} from '@trpc/tanstack-react-query';
import { ReactFlowProvider } from '@xyflow/react';

import { getQueryClient } from './flow-query-client';
import { createTRPCLinks } from './trpc-links';
import { useFluxeryEditorState } from './use-fluxery-editor-state';

import type {
  FluxeryContextValue,
  FluxeryProviderProps,
  PluginTRPCProviderProps,
} from './flow-types';

const FluxeryContext = createContext<FluxeryContextValue | null>(null);

const { useTRPC, TRPCProvider } = createTRPCContext();

const FluxeryProviderBody = <Context extends object>({
  children,
  queryClient,
  ...props
}: FluxeryProviderProps<Context> & { queryClient: QueryClient }) => {
  const trpc = useTRPC();
  const value = useFluxeryEditorState({
    ...props,
    queryClient,
    trpc,
  });

  return (
    <FluxeryContext.Provider value={value as FluxeryContextValue}>
      {children}
    </FluxeryContext.Provider>
  );
};

/**
 * Provider for plugin TRPC communication.
 *
 * Wraps children with a configured TRPC client scoped to a specific plugin endpoint.
 * Use this when you need standalone TRPC access outside of the full `FluxeryProvider`.
 * The TRPC client is created once from the initial `pluginContext`; changing the
 * prop later does not rebuild the client for existing descendants.
 *
 * @example
 * ```tsx
 * <PluginTRPCProvider pluginContext={{ baseUrl: '/api', endpoint: '/trpc' }}>
 *   <MyPluginComponent />
 * </PluginTRPCProvider>
 * ```
 */
export const PluginTRPCProvider = ({
  children,
  pluginContext,
  queryClient: providedQueryClient,
}: PluginTRPCProviderProps) => {
  const queryClient = providedQueryClient ?? getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient({
      links: createTRPCLinks(pluginContext.baseUrl, pluginContext.endpoint),
    }),
  );

  return (
    <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
      {children}
    </TRPCProvider>
  );
};

/**
 * Top-level provider for a Fluxery workflow editor.
 *
 * Sets up React Flow, TanStack Query, and TRPC contexts required by all Fluxery
 * components. Wrap your entire editor UI with this provider.
 *
 * The provider creates one TRPC client per mounted instance using the initial
 * `pluginContext`, and reuses either the supplied `queryClient` or the shared
 * singleton from {@link getQueryClient}. Changing `pluginContext` after mount does
 * not recreate the TRPC client automatically.
 *
 * @typeParam Context - Application-specific context type passed to node handlers.
 *
 * @example
 * ```tsx
 * <FluxeryProvider
 *   theme="light"
 *   nodeSchemas={schemas}
 *   pluginContext={{ baseUrl: '/api', endpoint: '/trpc' }}
 *   extras={{}}
 * >
 *   <FluxeryContainer>
 *     <FluxeryCore />
 *   </FluxeryContainer>
 * </FluxeryProvider>
 * ```
 */
export const FluxeryProvider = <Context extends object>(
  props: FluxeryProviderProps<Context> & {
    queryClient?: QueryClient;
  },
) => {
  const queryClient = props.queryClient ?? getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient({
      links: createTRPCLinks(props.pluginContext.baseUrl, props.pluginContext.endpoint),
    }),
  );
  return (
    <ReactFlowProvider>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
          <FluxeryProviderBody {...props} queryClient={queryClient} />
        </TRPCProvider>
      </QueryClientProvider>
    </ReactFlowProvider>
  );
};

/**
 * Hook to access the Fluxery editor state and APIs.
 *
 * Returns the full `FluxeryContextValue` including theme, node schemas, flow props,
 * editing API, run status, and more.
 *
 * @throws {Error} If called outside of a `FluxeryProvider`.
 *
 * @example
 * ```tsx
 * const { flow, selectedNode, editing, isReadOnly } = useFlow();
 * ```
 */
export const useFlow = () => {
  const context = useContext(FluxeryContext);
  if (context === null) {
    throw new Error('useFlow must be used within a FluxeryProvider');
  }
  return context;
};

/**
 * Retrieves TRPC plugin APIs from a TRPC client by plugin name.
 *
 * Use this for imperative access to plugin APIs outside of React component trees.
 * For use inside components, prefer {@link useTRPCPluginAPIs}.
 *
 * @typeParam Plugin - The TRPC plugin type to retrieve APIs for.
 * @param trpc - The TRPC client instance.
 * @param name - The registered name of the plugin.
 * @returns A typed TRPC options proxy for the plugin's router.
 */
export const getTRPCPluginAPIs = <Plugin extends TrpcApiPlugin>(
  trpc: TRPCClient,
  name: InferTrpcPluginName<Plugin>,
) => {
  return trpc[name] as TRPCOptionsProxy<InferTrpcPluginRouter<Plugin>, DefaultFeatureFlags>;
};

/**
 * Hook to access TRPC plugin APIs by name.
 *
 * Must be used within a `FluxeryProvider` or `PluginTRPCProvider`.
 *
 * @typeParam Plugin - The TRPC plugin type to retrieve APIs for.
 * @param name - The registered name of the plugin.
 * @returns An object containing the typed `client` proxy for the plugin's router.
 * The wrapper object keeps this hook's return shape stable if more helpers need to
 * be added alongside the client in the future.
 *
 * @example
 * ```tsx
 * const { client } = useTRPCPluginAPIs<MyPlugin>('my-plugin');
 * const data = client.myProcedure.useQuery();
 * ```
 */
export const useTRPCPluginAPIs = <Plugin extends TrpcApiPlugin>(
  name: InferTrpcPluginName<Plugin>,
) => {
  const trpc = useTRPC();
  const client = getTRPCPluginAPIs(trpc, name);
  return { client };
};
