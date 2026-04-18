'use client';

import { useMemo } from 'react';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';

import { useDeviceService, type DeviceServiceEvent } from './use-device-service';

import type { DeviceProtocolResponse } from '../lib/device-protocol-types';

import {
  getServiceContractEventOutput,
  getServiceContractMethod,
  getServiceContractResponseOutputs,
  type BaseServiceContract,
  type ServiceContractEventMessageType,
  type ServiceContractEventPayload,
  type ServiceContractMethodRequest,
  type ServiceContractMethodSuccessPayload,
  type ServiceContractNotifyMethodName,
  type ServiceContractResponseMethodName,
} from '../lib/service-contract-runtime';
import { useLiveTransport } from '../providers/live-transport-provider';

const DEFAULT_QUERY_STALE_TIME_MS = 5_000;
const DEFAULT_RESPONSE_SUBTOPIC = 'response';

export type TypedDeviceServiceRequestOptions = Readonly<{
  requestId?: string;
  timeoutMs?: number;
}>;

type QueryDataUpdater<TData> =
  | TData
  | undefined
  | ((current: TData | undefined) => TData | undefined);

type TypedDeviceServiceEvent<TPayload> = DeviceServiceEvent<TPayload>;

export type TypedDeviceServiceClient<TContract extends BaseServiceContract> = Readonly<{
  baseQueryKey: QueryKey;
  contract: TContract;
  invalidateQueries: <TMethod extends ServiceContractResponseMethodName<TContract>>(
    method?: TMethod,
    input?: ServiceContractMethodRequest<TContract, TMethod>,
  ) => Promise<void>;
  isConnected: boolean;
  notify: <TMethod extends ServiceContractNotifyMethodName<TContract>>(
    method: TMethod,
    input: ServiceContractMethodRequest<TContract, TMethod>,
  ) => void;
  queryKey: <TMethod extends ServiceContractResponseMethodName<TContract>>(
    method: TMethod,
    input: ServiceContractMethodRequest<TContract, TMethod>,
  ) => QueryKey;
  raw: ReturnType<typeof useDeviceService>;
  request: <TMethod extends ServiceContractResponseMethodName<TContract>>(
    method: TMethod,
    input: ServiceContractMethodRequest<TContract, TMethod>,
    options?: TypedDeviceServiceRequestOptions,
  ) => Promise<DeviceProtocolResponse<ServiceContractMethodSuccessPayload<TContract, TMethod>>>;
  serviceName: string;
  setQueryData: <TMethod extends ServiceContractResponseMethodName<TContract>>(
    method: TMethod,
    input: ServiceContractMethodRequest<TContract, TMethod>,
    updater: QueryDataUpdater<ServiceContractMethodSuccessPayload<TContract, TMethod>>,
  ) => void;
  subscribeEvent: <TMessageType extends ServiceContractEventMessageType<TContract>>(
    messageType: TMessageType,
    handler: (
      event: TypedDeviceServiceEvent<ServiceContractEventPayload<TContract, TMessageType>>,
    ) => void,
  ) => () => void;
}>;

export type UseDeviceServiceQueryOptions<
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractResponseMethodName<TContract>,
  TData = ServiceContractMethodSuccessPayload<TContract, TMethod>,
> = Omit<
  UseQueryOptions<ServiceContractMethodSuccessPayload<TContract, TMethod>, Error, TData, QueryKey>,
  'queryFn' | 'queryKey'
> & {
  requestOptions?: TypedDeviceServiceRequestOptions;
};

export type UseDeviceServiceMutationOptions<
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractResponseMethodName<TContract>,
  TContext = unknown,
> = Omit<
  UseMutationOptions<
    ServiceContractMethodSuccessPayload<TContract, TMethod>,
    Error,
    ServiceContractMethodRequest<TContract, TMethod>,
    TContext
  >,
  'mutationFn'
> & {
  requestOptions?:
    | TypedDeviceServiceRequestOptions
    | ((
        input: ServiceContractMethodRequest<TContract, TMethod>,
      ) => TypedDeviceServiceRequestOptions | undefined);
};

export const useTypedDeviceService = <TContract extends BaseServiceContract>(
  contract: TContract,
  options?: Readonly<{
    serviceName?: string;
  }>,
): TypedDeviceServiceClient<TContract> => {
  const { deviceId, transportMode, transportState } = useLiveTransport();
  const queryClient = useQueryClient();
  const resolvedServiceName = options?.serviceName?.trim() ?? contract.name;
  const rawService = useDeviceService(resolvedServiceName);
  const isConnected = rawService.serviceName !== '' && transportState === 'connected';
  const baseQueryKey = useMemo(
    () =>
      ['live-transport', transportMode, deviceId, contract.name, rawService.serviceName] as const,
    [contract.name, deviceId, rawService.serviceName, transportMode],
  );

  return useMemo(
    () => ({
      baseQueryKey,
      contract,
      invalidateQueries: async <TMethod extends ServiceContractResponseMethodName<TContract>>(
        method?: TMethod,
        input?: ServiceContractMethodRequest<TContract, TMethod>,
      ) => {
        if (method === undefined) {
          await queryClient.invalidateQueries({
            queryKey: baseQueryKey,
          });
          return;
        }

        const queryKey =
          input === undefined ? [...baseQueryKey, method] : [...baseQueryKey, method, input];
        await queryClient.invalidateQueries({
          queryKey,
        });
      },
      isConnected,
      notify: <TMethod extends ServiceContractNotifyMethodName<TContract>>(
        method: TMethod,
        input: ServiceContractMethodRequest<TContract, TMethod>,
      ) => {
        const methodDefinition = getServiceContractMethod(contract, method);
        rawService.notify(method, input, {
          subtopic: methodDefinition.subtopic,
        });
      },
      queryKey: <TMethod extends ServiceContractResponseMethodName<TContract>>(
        method: TMethod,
        input: ServiceContractMethodRequest<TContract, TMethod>,
      ) => [...baseQueryKey, method, input] as const,
      raw: rawService,
      request: async <TMethod extends ServiceContractResponseMethodName<TContract>>(
        method: TMethod,
        input: ServiceContractMethodRequest<TContract, TMethod>,
        requestOptions?: TypedDeviceServiceRequestOptions,
      ) => {
        const methodDefinition = getServiceContractMethod(contract, method);
        const responseOutputs = getServiceContractResponseOutputs(contract, method);
        const responseTypes = responseOutputs.map((output) => output.messageType);
        const responseSubtopics = Array.from(
          new Set(responseOutputs.map((output) => output.subtopic)),
        );

        return rawService.request(method, input, {
          requestId: requestOptions?.requestId,
          responseSubtopics:
            responseSubtopics.length > 0 ? responseSubtopics : [DEFAULT_RESPONSE_SUBTOPIC],
          responseTypes,
          subtopic: methodDefinition.subtopic,
          timeoutMs: requestOptions?.timeoutMs,
        });
      },
      serviceName: rawService.serviceName,
      setQueryData: <TMethod extends ServiceContractResponseMethodName<TContract>>(
        method: TMethod,
        input: ServiceContractMethodRequest<TContract, TMethod>,
        updater: QueryDataUpdater<ServiceContractMethodSuccessPayload<TContract, TMethod>>,
      ) => {
        queryClient.setQueryData(
          [...baseQueryKey, method, input],
          updater as QueryDataUpdater<ServiceContractMethodSuccessPayload<TContract, TMethod>>,
        );
      },
      subscribeEvent: <TMessageType extends ServiceContractEventMessageType<TContract>>(
        messageType: TMessageType,
        handler: (
          event: TypedDeviceServiceEvent<ServiceContractEventPayload<TContract, TMessageType>>,
        ) => void,
      ) => {
        const eventOutput = getServiceContractEventOutput(contract, messageType);
        if (eventOutput === null) {
          return () => {};
        }

        return rawService.subscribe<ServiceContractEventPayload<TContract, TMessageType>>(handler, {
          subtopics: [eventOutput.subtopic],
          types: [messageType],
        });
      },
    }),
    [baseQueryKey, contract, isConnected, queryClient, rawService],
  );
};

export const useDeviceServiceQuery = <
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractResponseMethodName<TContract>,
  TData = ServiceContractMethodSuccessPayload<TContract, TMethod>,
>(
  service: TypedDeviceServiceClient<TContract>,
  method: TMethod,
  input: ServiceContractMethodRequest<TContract, TMethod>,
  options?: UseDeviceServiceQueryOptions<TContract, TMethod, TData>,
) => {
  const { requestOptions, ...queryOptions } = options ?? {};

  return useQuery<ServiceContractMethodSuccessPayload<TContract, TMethod>, Error, TData, QueryKey>({
    ...queryOptions,
    enabled: service.isConnected && (queryOptions.enabled ?? true),
    queryFn: async () => {
      const response = await service.request(method, input, requestOptions);
      return response.payload;
    },
    queryKey: service.queryKey(method, input),
    refetchOnWindowFocus: queryOptions.refetchOnWindowFocus ?? false,
    retry: queryOptions.retry ?? false,
    staleTime: queryOptions.staleTime ?? DEFAULT_QUERY_STALE_TIME_MS,
  });
};

export const useDeviceServiceMutation = <
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractResponseMethodName<TContract>,
  TContext = unknown,
>(
  service: TypedDeviceServiceClient<TContract>,
  method: TMethod,
  options?: UseDeviceServiceMutationOptions<TContract, TMethod, TContext>,
) => {
  const { requestOptions, ...mutationOptions } = options ?? {};

  return useMutation<
    ServiceContractMethodSuccessPayload<TContract, TMethod>,
    Error,
    ServiceContractMethodRequest<TContract, TMethod>,
    TContext
  >({
    ...mutationOptions,
    mutationFn: async (input: ServiceContractMethodRequest<TContract, TMethod>) => {
      const resolvedRequestOptions =
        typeof requestOptions === 'function' ? requestOptions(input) : requestOptions;
      const response = await service.request(method, input, resolvedRequestOptions);
      return response.payload;
    },
  });
};
