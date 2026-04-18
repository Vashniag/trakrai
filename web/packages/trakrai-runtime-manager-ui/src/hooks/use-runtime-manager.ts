'use client';

import { useCallback, useMemo, useState } from 'react';

import {
  runtime_managerContract,
  type RuntimeManager_RuntimeActionPayload,
} from '@trakrai/live-transport/generated-contracts/runtime_manager';
import {
  useDeviceServiceMutation,
  useDeviceServiceQuery,
  useTypedDeviceService,
} from '@trakrai/live-transport/hooks/use-typed-device-service';
import { isDeviceProtocolRequestError } from '@trakrai/live-transport/lib/device-protocol-types';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import type {
  ManagedRuntimeService,
  ManagedRuntimeServiceDefinition,
  RuntimeManagerLogPayload,
  RuntimeManagerPaths,
  RuntimeManagerStatusPayload,
} from '@trakrai/live-transport/lib/runtime-manager-types';

export type RuntimeManagerState = {
  activeDefinition: ManagedRuntimeServiceDefinition | null;
  error: string | null;
  isBusy: boolean;
  lastLog: RuntimeManagerLogPayload | null;
  lastRefreshedAt: string | null;
  loadServiceDefinition: (serviceName: string) => void;
  paths: RuntimeManagerPaths | null;
  refreshLogs: (serviceName: string, lines?: number) => void;
  refreshStatus: () => void;
  removeService: (serviceName: string, purgeFiles?: boolean) => void;
  runServiceAction: (
    serviceName: string,
    action: 'restart-service' | 'start-service' | 'stop-service',
  ) => void;
  serviceName: string;
  serviceRegistered: boolean;
  services: ManagedRuntimeService[];
  statusLabel: string;
  systemMetrics: RuntimeManagerStatusPayload['system'] | null;
  updateService: (serviceName: string, input: UpdateServiceInput) => void;
  upsertServiceDefinition: (definition: ManagedRuntimeServiceDefinition) => void;
};

export type UpdateServiceInput = Readonly<{
  artifactSha256?: string;
  remotePath?: string;
}>;

const AUTO_REFRESH_INTERVAL_MS = 5_000;
const DEFAULT_LOG_LINES = 80;
const DEFAULT_TIMEOUT_MS = 900_000;
const EMPTY_STATUS_INPUT = {} as const;
const EMPTY_DEFINITION_INPUT = { serviceName: '' } as const;
const EMPTY_LOG_INPUT = { lines: DEFAULT_LOG_LINES, serviceName: '' } as const;

const readRequestErrorMessage = (error: unknown): string => {
  if (isDeviceProtocolRequestError(error) && error.payload !== null) {
    const payload = error.payload as { error?: string };
    if (typeof payload.error === 'string' && payload.error.trim() !== '') {
      return payload.error;
    }
  }

  return error instanceof Error ? error.message : 'Runtime manager request failed';
};

const summarizeAction = (payload: RuntimeManager_RuntimeActionPayload): string =>
  payload.message ??
  `${payload.action} completed for ${payload.service?.displayName ?? payload.serviceName}`;

export const useRuntimeManager = (serviceName: string): RuntimeManagerState => {
  const normalizedServiceName = serviceName.trim();
  const { appendLog, deviceStatus, transportState } = useLiveTransport();
  const runtimeManagerService = useTypedDeviceService(runtime_managerContract, {
    serviceName: normalizedServiceName,
  });
  const runtimeManagerServiceStatus = deviceStatus?.services?.[normalizedServiceName];
  const [definitionServiceName, setDefinitionServiceName] = useState<string>('');
  const [logRequest, setLogRequest] = useState<{
    lines: number;
    serviceName: string;
  }>({
    lines: DEFAULT_LOG_LINES,
    serviceName: '',
  });

  const statusQuery = useDeviceServiceQuery(
    runtimeManagerService,
    'get-status',
    EMPTY_STATUS_INPUT,
    {
      enabled: normalizedServiceName !== '',
      refetchInterval: transportState === 'connected' ? AUTO_REFRESH_INTERVAL_MS : false,
      refetchIntervalInBackground: true,
    },
  );

  const definitionInput =
    definitionServiceName !== ''
      ? {
          serviceName: definitionServiceName,
        }
      : EMPTY_DEFINITION_INPUT;
  const definitionQuery = useDeviceServiceQuery(
    runtimeManagerService,
    'get-service-definition',
    definitionInput,
    {
      enabled: definitionServiceName !== '',
      staleTime: 60_000,
    },
  );

  const logInput =
    logRequest.serviceName !== ''
      ? {
          lines: logRequest.lines,
          serviceName: logRequest.serviceName,
        }
      : EMPTY_LOG_INPUT;
  const logQuery = useDeviceServiceQuery(runtimeManagerService, 'get-service-log', logInput, {
    enabled: logRequest.serviceName !== '',
    staleTime: 2_000,
  });

  const handleActionSuccess = useCallback(
    (payload: RuntimeManager_RuntimeActionPayload) => {
      appendLog('info', summarizeAction(payload));
      void runtimeManagerService.invalidateQueries('get-status');
      if (payload.serviceName.trim() !== '') {
        void runtimeManagerService.invalidateQueries('get-service-definition', {
          serviceName: payload.serviceName,
        });
      }
      if (payload.removed === true && payload.serviceName === definitionServiceName) {
        setDefinitionServiceName('');
      }
    },
    [appendLog, definitionServiceName, runtimeManagerService],
  );

  const restartServiceMutation = useDeviceServiceMutation(
    runtimeManagerService,
    'restart-service',
    {
      onSuccess: handleActionSuccess,
    },
  );
  const startServiceMutation = useDeviceServiceMutation(runtimeManagerService, 'start-service', {
    onSuccess: handleActionSuccess,
  });
  const stopServiceMutation = useDeviceServiceMutation(runtimeManagerService, 'stop-service', {
    onSuccess: handleActionSuccess,
  });
  const updateServiceMutation = useDeviceServiceMutation(runtimeManagerService, 'update-service', {
    onSuccess: handleActionSuccess,
    requestOptions: {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
  });
  const upsertServiceMutation = useDeviceServiceMutation(runtimeManagerService, 'upsert-service', {
    onSuccess: handleActionSuccess,
  });
  const removeServiceMutation = useDeviceServiceMutation(runtimeManagerService, 'remove-service', {
    onSuccess: handleActionSuccess,
  });

  const resetMutationErrors = useCallback(() => {
    restartServiceMutation.reset();
    startServiceMutation.reset();
    stopServiceMutation.reset();
    updateServiceMutation.reset();
    upsertServiceMutation.reset();
    removeServiceMutation.reset();
  }, [
    removeServiceMutation,
    restartServiceMutation,
    startServiceMutation,
    stopServiceMutation,
    updateServiceMutation,
    upsertServiceMutation,
  ]);

  const refreshStatus = useCallback(() => {
    resetMutationErrors();
    void statusQuery.refetch();
  }, [resetMutationErrors, statusQuery]);

  const refreshLogs = useCallback(
    (targetServiceName: string, lines = DEFAULT_LOG_LINES) => {
      resetMutationErrors();
      const nextServiceName = targetServiceName.trim();
      if (nextServiceName === '') {
        return;
      }

      if (logRequest.serviceName === nextServiceName && logRequest.lines === lines) {
        void logQuery.refetch();
        return;
      }

      setLogRequest({
        lines,
        serviceName: nextServiceName,
      });
    },
    [logQuery, logRequest.lines, logRequest.serviceName, resetMutationErrors],
  );

  const loadServiceDefinition = useCallback(
    (targetServiceName: string) => {
      resetMutationErrors();
      const nextServiceName = targetServiceName.trim();
      if (nextServiceName === '') {
        return;
      }

      if (definitionServiceName === nextServiceName) {
        void definitionQuery.refetch();
        return;
      }

      setDefinitionServiceName(nextServiceName);
    },
    [definitionQuery, definitionServiceName, resetMutationErrors],
  );

  const runServiceAction = useCallback(
    (targetServiceName: string, action: 'restart-service' | 'start-service' | 'stop-service') => {
      const nextServiceName = targetServiceName.trim();
      if (nextServiceName === '') {
        return;
      }

      resetMutationErrors();
      if (action === 'restart-service') {
        void restartServiceMutation.mutateAsync({
          serviceName: nextServiceName,
        });
        return;
      }
      if (action === 'start-service') {
        void startServiceMutation.mutateAsync({
          serviceName: nextServiceName,
        });
        return;
      }

      void stopServiceMutation.mutateAsync({
        serviceName: nextServiceName,
      });
    },
    [resetMutationErrors, restartServiceMutation, startServiceMutation, stopServiceMutation],
  );

  const updateService = useCallback(
    (targetServiceName: string, input: UpdateServiceInput) => {
      const nextServiceName = targetServiceName.trim();
      if (nextServiceName === '') {
        return;
      }

      resetMutationErrors();
      void updateServiceMutation.mutateAsync({
        artifactSha256: input.artifactSha256,
        remotePath: input.remotePath,
        serviceName: nextServiceName,
      });
    },
    [resetMutationErrors, updateServiceMutation],
  );

  const upsertServiceDefinition = useCallback(
    (definition: ManagedRuntimeServiceDefinition) => {
      resetMutationErrors();
      setDefinitionServiceName(definition.name.trim());
      void upsertServiceMutation.mutateAsync({
        definition,
      });
    },
    [resetMutationErrors, upsertServiceMutation],
  );

  const removeService = useCallback(
    (targetServiceName: string, purgeFiles = false) => {
      const nextServiceName = targetServiceName.trim();
      if (nextServiceName === '') {
        return;
      }

      resetMutationErrors();
      void removeServiceMutation.mutateAsync({
        purgeFiles,
        serviceName: nextServiceName,
      });
    },
    [removeServiceMutation, resetMutationErrors],
  );

  const paths = useMemo<RuntimeManagerPaths | null>(() => {
    if (statusQuery.data === undefined) {
      return null;
    }

    return {
      binaryDir: statusQuery.data.binaryDir,
      configDir: statusQuery.data.configDir,
      downloadDir: statusQuery.data.downloadDir,
      logDir: statusQuery.data.logDir,
      scriptDir: statusQuery.data.scriptDir,
      sharedDir: statusQuery.data.sharedDir,
      stateFile: statusQuery.data.stateFile,
      versionDir: statusQuery.data.versionDir,
    };
  }, [statusQuery.data]);

  const transientError =
    restartServiceMutation.error ??
    startServiceMutation.error ??
    stopServiceMutation.error ??
    updateServiceMutation.error ??
    upsertServiceMutation.error ??
    removeServiceMutation.error ??
    definitionQuery.error ??
    logQuery.error ??
    statusQuery.error;

  const error =
    (transientError === null ? null : readRequestErrorMessage(transientError)) ??
    statusQuery.data?.lastError ??
    null;

  const isBusy =
    definitionQuery.isFetching ||
    logQuery.isFetching ||
    restartServiceMutation.isPending ||
    startServiceMutation.isPending ||
    stopServiceMutation.isPending ||
    updateServiceMutation.isPending ||
    upsertServiceMutation.isPending ||
    removeServiceMutation.isPending;

  return useMemo(
    () => ({
      activeDefinition: definitionQuery.data?.definition ?? null,
      error,
      isBusy,
      lastLog: logQuery.data ?? null,
      lastRefreshedAt: statusQuery.data?.generatedAt ?? null,
      loadServiceDefinition,
      paths,
      refreshLogs,
      refreshStatus,
      removeService,
      runServiceAction,
      serviceName: normalizedServiceName,
      serviceRegistered: runtimeManagerServiceStatus !== undefined,
      services: statusQuery.data?.services ?? [],
      statusLabel: runtimeManagerServiceStatus?.status ?? 'offline',
      systemMetrics: statusQuery.data?.system ?? null,
      updateService,
      upsertServiceDefinition,
    }),
    [
      definitionQuery.data,
      error,
      isBusy,
      loadServiceDefinition,
      logQuery.data,
      normalizedServiceName,
      paths,
      refreshLogs,
      refreshStatus,
      removeService,
      runServiceAction,
      runtimeManagerServiceStatus,
      statusQuery.data,
      updateService,
      upsertServiceDefinition,
    ],
  );
};
