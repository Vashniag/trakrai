'use client';

import { useCallback, useMemo } from 'react';

import type {
  DeviceProtocolNotifyOptions,
  DeviceProtocolRequestOptions,
  DeviceProtocolResponse,
} from '../lib/device-protocol-types';
import type { TransportPacket } from '../lib/live-types';

import { getEnvelopeType, unwrapPayload } from '../lib/live-transport-utils';
import { useLiveTransport } from '../providers/live-transport-provider';

export type DeviceServiceEvent<TPayload = unknown> = Readonly<{
  packet: TransportPacket;
  payload: TPayload;
  responseType: string | null;
}>;

export type DeviceServiceSubscriptionOptions = Readonly<{
  subtopics?: readonly string[];
  types?: readonly string[];
}>;

export const useDeviceService = (serviceName: string) => {
  const protocol = useLiveTransport();
  const normalizedServiceName = serviceName.trim();

  const request = useCallback(
    <TPayload extends Record<string, unknown>, TResponsePayload = unknown>(
      command: string,
      payload?: TPayload,
      options?: Omit<DeviceProtocolRequestOptions<TPayload>, 'command' | 'payload' | 'service'>,
    ): Promise<DeviceProtocolResponse<TResponsePayload>> =>
      protocol.request<TPayload, TResponsePayload>({
        ...options,
        command,
        payload,
        service: normalizedServiceName,
      }),
    [normalizedServiceName, protocol],
  );

  const notify = useCallback(
    <TPayload extends Record<string, unknown>>(
      type: string,
      payload?: TPayload,
      options?: Omit<DeviceProtocolNotifyOptions<TPayload>, 'payload' | 'service' | 'type'>,
    ) => {
      protocol.notify({
        ...options,
        payload,
        service: normalizedServiceName,
        type,
      });
    },
    [normalizedServiceName, protocol],
  );

  const subscribe = useCallback(
    <TPayload = unknown>(
      handler: (event: DeviceServiceEvent<TPayload>) => void,
      options?: DeviceServiceSubscriptionOptions,
    ) =>
      protocol.subscribeToPackets((packet: TransportPacket) => {
        if ((packet.service ?? '') !== normalizedServiceName) {
          return;
        }
        if (
          options?.subtopics !== undefined &&
          options.subtopics.length > 0 &&
          !options.subtopics.includes(packet.subtopic)
        ) {
          return;
        }

        const responseType = getEnvelopeType(packet.envelope);
        if (
          options?.types !== undefined &&
          options.types.length > 0 &&
          (responseType === null || !options.types.includes(responseType))
        ) {
          return;
        }

        handler({
          packet,
          payload: unwrapPayload<TPayload>(packet.envelope),
          responseType,
        });
      }),
    [normalizedServiceName, protocol],
  );

  return useMemo(
    () => ({
      ...protocol,
      notify,
      request,
      serviceName: normalizedServiceName,
      subscribe,
    }),
    [normalizedServiceName, notify, protocol, request, subscribe],
  );
};
