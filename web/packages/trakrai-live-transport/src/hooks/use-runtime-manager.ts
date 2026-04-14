'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDeviceRuntime } from './use-device-runtime';
import { useLiveTransport } from './use-live-transport';

import type {
  ManagedRuntimeService,
  ManagedRuntimeServiceDefinition,
  RuntimeManagerActionPayload,
  RuntimeManagerDefinitionPayload,
  RuntimeManagerErrorPayload,
  RuntimeManagerLogPayload,
  RuntimeManagerPaths,
  RuntimeManagerStatusPayload,
} from '../lib/runtime-manager-types';

import { createClientRequestId, getEnvelopeType, unwrapPayload } from '../lib/live-transport-utils';

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

const mergeUpdatedService = (
  currentServices: ManagedRuntimeService[],
  updatedService: ManagedRuntimeService,
): ManagedRuntimeService[] =>
  currentServices.map((service) =>
    service.name === updatedService.name ? updatedService : service,
  );

export const useRuntimeManager = (serviceName: string): RuntimeManagerState => {
  const normalizedServiceName = serviceName.trim();
  const { appendLog, deviceStatus } = useDeviceRuntime();
  const { sendPacket, subscribeToPackets, transportState } = useLiveTransport();
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

  const sendManagerPacket = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      if (normalizedServiceName === '') {
        return;
      }

      setIsBusy(true);
      sendPacket({
        payload,
        service: normalizedServiceName,
        subtopic: 'command',
        type,
      });
    },
    [normalizedServiceName, sendPacket],
  );

  const refreshStatus = useCallback(() => {
    setError(null);
    sendManagerPacket('get-status', {
      requestId: createClientRequestId(),
    });
  }, [sendManagerPacket]);

  const refreshLogs = useCallback(
    (targetServiceName: string, lines = 80) => {
      setError(null);
      sendManagerPacket('get-service-log', {
        lines,
        requestId: createClientRequestId(),
        serviceName: targetServiceName,
      });
    },
    [sendManagerPacket],
  );

  const runServiceAction = useCallback(
    (targetServiceName: string, action: 'restart-service' | 'start-service' | 'stop-service') => {
      setError(null);
      sendManagerPacket(action, {
        requestId: createClientRequestId(),
        serviceName: targetServiceName,
      });
    },
    [sendManagerPacket],
  );

  const updateService = useCallback(
    (targetServiceName: string, artifactUrl: string) => {
      setError(null);
      sendManagerPacket('update-service', {
        artifactUrl,
        requestId: createClientRequestId(),
        serviceName: targetServiceName,
      });
    },
    [sendManagerPacket],
  );

  const loadServiceDefinition = useCallback(
    (targetServiceName: string) => {
      setError(null);
      sendManagerPacket('get-service-definition', {
        requestId: createClientRequestId(),
        serviceName: targetServiceName,
      });
    },
    [sendManagerPacket],
  );

  const upsertServiceDefinition = useCallback(
    (definition: ManagedRuntimeServiceDefinition) => {
      setError(null);
      sendManagerPacket('upsert-service', {
        definition,
        requestId: createClientRequestId(),
      });
    },
    [sendManagerPacket],
  );

  const removeService = useCallback(
    (targetServiceName: string, purgeFiles = false) => {
      setError(null);
      sendManagerPacket('remove-service', {
        purgeFiles,
        requestId: createClientRequestId(),
        serviceName: targetServiceName,
      });
    },
    [sendManagerPacket],
  );

  useEffect(() => {
    const unsubscribePackets = subscribeToPackets((packet) => {
      if (
        (packet.service ?? '') !== normalizedServiceName ||
        packet.subtopic !== RESPONSE_SUBTOPIC
      ) {
        return;
      }

      const responseType = getEnvelopeType(packet.envelope);
      if (responseType === null) {
        return;
      }

      if (responseType === 'runtime-manager-status') {
        const payload = unwrapPayload<RuntimeManagerStatusPayload>(packet.envelope);
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
        return;
      }

      if (responseType === 'runtime-manager-service-definition') {
        const payload = unwrapPayload<RuntimeManagerDefinitionPayload>(packet.envelope);
        setActiveDefinition(payload.definition);
        setIsBusy(false);
        return;
      }

      if (responseType === 'runtime-manager-log') {
        const payload = unwrapPayload<RuntimeManagerLogPayload>(packet.envelope);
        setLastLog(payload);
        setIsBusy(false);
        return;
      }

      if (
        responseType === 'runtime-manager-service-action' ||
        responseType === 'runtime-manager-update'
      ) {
        const payload = unwrapPayload<RuntimeManagerActionPayload>(packet.envelope);
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
            `${payload.action} completed for ${payload.service?.displayName ?? payload.serviceName}`,
        );
        refreshStatus();
        return;
      }

      if (responseType === 'runtime-manager-error' || responseType === 'service-unavailable') {
        const payload = unwrapPayload<RuntimeManagerErrorPayload>(packet.envelope);
        const nextError = payload.error;
        setError(nextError);
        setIsBusy(false);
        appendLog('error', nextError);
      }
    });

    return () => {
      unsubscribePackets();
    };
  }, [activeDefinition?.name, appendLog, normalizedServiceName, refreshStatus, subscribeToPackets]);

  useEffect(() => {
    if (normalizedServiceName === '' || transportState !== 'connected') {
      return;
    }

    sendPacket({
      payload: {
        requestId: createClientRequestId(),
      },
      service: normalizedServiceName,
      subtopic: 'command',
      type: 'get-status',
    });
  }, [normalizedServiceName, sendPacket, transportState]);

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
