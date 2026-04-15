'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDeviceService } from '@trakrai/live-transport/hooks/use-device-service';
import { isDeviceProtocolRequestError } from '@trakrai/live-transport/lib/device-protocol-types';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import type {
  ManagedRuntimeService,
  ManagedRuntimeServiceDefinition,
  RuntimeManagerActionPayload,
  RuntimeManagerDefinitionPayload,
  RuntimeManagerErrorPayload,
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
  paths: RuntimeManagerPaths | null;
  removeService: (serviceName: string, purgeFiles?: boolean) => void;
  loadServiceDefinition: (serviceName: string) => void;
  refreshLogs: (serviceName: string, lines?: number) => void;
  refreshStatus: () => void;
  runServiceAction: (
    serviceName: string,
    action: 'restart-service' | 'start-service' | 'stop-service',
  ) => void;
  serviceName: string;
  serviceRegistered: boolean;
  services: ManagedRuntimeService[];
  statusLabel: string;
  updateService: (serviceName: string, artifactUrl: string) => void;
  upsertServiceDefinition: (definition: ManagedRuntimeServiceDefinition) => void;
};

const RESPONSE_SUBTOPIC = 'response';
const ACTION_RESPONSE_TYPES = ['runtime-manager-service-action', 'runtime-manager-update'] as const;

const mergeUpdatedService = (
  currentServices: ManagedRuntimeService[],
  updatedService: ManagedRuntimeService,
): ManagedRuntimeService[] =>
  currentServices.map((service) =>
    service.name === updatedService.name ? updatedService : service,
  );

export const useRuntimeManager = (serviceName: string): RuntimeManagerState => {
  const normalizedServiceName = serviceName.trim();
  const { appendLog, deviceStatus, transportState } = useLiveTransport();
  const runtimeManagerService = useDeviceService(normalizedServiceName);
  const [services, setServices] = useState<ManagedRuntimeService[]>([]);
  const [paths, setPaths] = useState<RuntimeManagerPaths | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [lastLog, setLastLog] = useState<RuntimeManagerLogPayload | null>(null);
  const [activeDefinition, setActiveDefinition] = useState<ManagedRuntimeServiceDefinition | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const runtimeManagerServiceStatus = deviceStatus?.services?.[normalizedServiceName];

  const applyStatusPayload = useCallback((payload: RuntimeManagerStatusPayload) => {
    setServices(payload.services);
    setPaths({
      binaryDir: payload.binaryDir,
      downloadDir: payload.downloadDir,
      logDir: payload.logDir,
      scriptDir: payload.scriptDir,
      stateFile: payload.stateFile,
      versionDir: payload.versionDir,
    });
    setLastRefreshedAt(payload.generatedAt);
    setError(payload.lastError ?? null);
    setIsBusy(false);
  }, []);

  const handleRequestError = useCallback(
    (nextError: unknown) => {
      const errorPayload =
        isDeviceProtocolRequestError(nextError) && nextError.payload !== null
          ? (nextError.payload as RuntimeManagerErrorPayload)
          : null;
      const errorMessage =
        errorPayload?.error ??
        (nextError instanceof Error ? nextError.message : 'Runtime manager request failed');
      setError(errorMessage);
      setIsBusy(false);
      appendLog('error', errorMessage);
    },
    [appendLog],
  );

  const applyActionPayload = useCallback(
    (payload: RuntimeManagerActionPayload) => {
      const updatedService = payload.service;

      if (updatedService !== undefined) {
        setServices((currentServices) => mergeUpdatedService(currentServices, updatedService));
      }

      if (payload.definition !== undefined) {
        setActiveDefinition(payload.definition);
      } else if (payload.removed === true && activeDefinition?.name === payload.serviceName) {
        setActiveDefinition(null);
      }

      setIsBusy(false);
      appendLog(
        'info',
        payload.message ??
          `${payload.action} completed for ${updatedService?.displayName ?? payload.serviceName}`,
      );
    },
    [activeDefinition?.name, appendLog],
  );

  const refreshStatus = useCallback(() => {
    if (normalizedServiceName === '') {
      return;
    }

    setError(null);
    setIsBusy(true);
    void runtimeManagerService
      .request<Record<string, never>, RuntimeManagerStatusPayload>(
        'get-status',
        {},
        {
          responseSubtopics: [RESPONSE_SUBTOPIC],
          responseTypes: ['runtime-manager-status'],
        },
      )
      .then((response) => {
        applyStatusPayload(response.payload);
        return undefined;
      })
      .catch(handleRequestError);
  }, [applyStatusPayload, handleRequestError, normalizedServiceName, runtimeManagerService]);

  const refreshLogs = useCallback(
    (targetServiceName: string, lines = 80) => {
      if (normalizedServiceName === '') {
        return;
      }

      setError(null);
      setIsBusy(true);
      void runtimeManagerService
        .request<{ lines: number; serviceName: string }, RuntimeManagerLogPayload>(
          'get-service-log',
          {
            lines,
            serviceName: targetServiceName,
          },
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: ['runtime-manager-log'],
          },
        )
        .then((response) => {
          setLastLog(response.payload);
          setIsBusy(false);
          return undefined;
        })
        .catch(handleRequestError);
    },
    [handleRequestError, normalizedServiceName, runtimeManagerService],
  );

  const runServiceAction = useCallback(
    (targetServiceName: string, action: 'restart-service' | 'start-service' | 'stop-service') => {
      if (normalizedServiceName === '') {
        return;
      }

      setError(null);
      setIsBusy(true);
      void runtimeManagerService
        .request<{ serviceName: string }, RuntimeManagerActionPayload>(
          action,
          {
            serviceName: targetServiceName,
          },
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: ACTION_RESPONSE_TYPES,
          },
        )
        .then((response) => {
          applyActionPayload(response.payload);
          refreshStatus();
          return undefined;
        })
        .catch(handleRequestError);
    },
    [
      applyActionPayload,
      handleRequestError,
      normalizedServiceName,
      refreshStatus,
      runtimeManagerService,
    ],
  );

  const updateService = useCallback(
    (targetServiceName: string, artifactUrl: string) => {
      if (normalizedServiceName === '') {
        return;
      }

      setError(null);
      setIsBusy(true);
      void runtimeManagerService
        .request<{ artifactUrl: string; serviceName: string }, RuntimeManagerActionPayload>(
          'update-service',
          {
            artifactUrl,
            serviceName: targetServiceName,
          },
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: ACTION_RESPONSE_TYPES,
          },
        )
        .then((response) => {
          applyActionPayload(response.payload);
          refreshStatus();
          return undefined;
        })
        .catch(handleRequestError);
    },
    [
      applyActionPayload,
      handleRequestError,
      normalizedServiceName,
      refreshStatus,
      runtimeManagerService,
    ],
  );

  const loadServiceDefinition = useCallback(
    (targetServiceName: string) => {
      if (normalizedServiceName === '') {
        return;
      }

      setError(null);
      setIsBusy(true);
      void runtimeManagerService
        .request<{ serviceName: string }, RuntimeManagerDefinitionPayload>(
          'get-service-definition',
          {
            serviceName: targetServiceName,
          },
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: ['runtime-manager-service-definition'],
          },
        )
        .then((response) => {
          setActiveDefinition(response.payload.definition);
          setIsBusy(false);
          return undefined;
        })
        .catch(handleRequestError);
    },
    [handleRequestError, normalizedServiceName, runtimeManagerService],
  );

  const upsertServiceDefinition = useCallback(
    (definition: ManagedRuntimeServiceDefinition) => {
      if (normalizedServiceName === '') {
        return;
      }

      setError(null);
      setIsBusy(true);
      void runtimeManagerService
        .request<{ definition: ManagedRuntimeServiceDefinition }, RuntimeManagerActionPayload>(
          'upsert-service',
          {
            definition,
          },
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: ACTION_RESPONSE_TYPES,
          },
        )
        .then((response) => {
          applyActionPayload(response.payload);
          refreshStatus();
          return undefined;
        })
        .catch(handleRequestError);
    },
    [
      applyActionPayload,
      handleRequestError,
      normalizedServiceName,
      refreshStatus,
      runtimeManagerService,
    ],
  );

  const removeService = useCallback(
    (targetServiceName: string, purgeFiles = false) => {
      if (normalizedServiceName === '') {
        return;
      }

      setError(null);
      setIsBusy(true);
      void runtimeManagerService
        .request<{ purgeFiles: boolean; serviceName: string }, RuntimeManagerActionPayload>(
          'remove-service',
          {
            purgeFiles,
            serviceName: targetServiceName,
          },
          {
            responseSubtopics: [RESPONSE_SUBTOPIC],
            responseTypes: ACTION_RESPONSE_TYPES,
          },
        )
        .then((response) => {
          applyActionPayload(response.payload);
          refreshStatus();
          return undefined;
        })
        .catch(handleRequestError);
    },
    [
      applyActionPayload,
      handleRequestError,
      normalizedServiceName,
      refreshStatus,
      runtimeManagerService,
    ],
  );

  useEffect(() => {
    if (normalizedServiceName === '' || transportState !== 'connected') {
      return;
    }

    void runtimeManagerService
      .request<Record<string, never>, RuntimeManagerStatusPayload>(
        'get-status',
        {},
        {
          responseSubtopics: [RESPONSE_SUBTOPIC],
          responseTypes: ['runtime-manager-status'],
        },
      )
      .then((response) => {
        applyStatusPayload(response.payload);
        return undefined;
      })
      .catch(handleRequestError);
  }, [
    applyStatusPayload,
    handleRequestError,
    normalizedServiceName,
    runtimeManagerService,
    transportState,
  ]);

  return useMemo(
    () => ({
      activeDefinition,
      error,
      isBusy,
      lastLog,
      lastRefreshedAt,
      loadServiceDefinition,
      paths,
      refreshLogs,
      refreshStatus,
      removeService,
      runServiceAction,
      serviceName: normalizedServiceName,
      serviceRegistered: runtimeManagerServiceStatus !== undefined,
      services,
      statusLabel: runtimeManagerServiceStatus?.status ?? 'offline',
      updateService,
      upsertServiceDefinition,
    }),
    [
      activeDefinition,
      error,
      isBusy,
      lastLog,
      lastRefreshedAt,
      loadServiceDefinition,
      normalizedServiceName,
      paths,
      refreshLogs,
      refreshStatus,
      removeService,
      runServiceAction,
      runtimeManagerServiceStatus,
      services,
      updateService,
      upsertServiceDefinition,
    ],
  );
};
