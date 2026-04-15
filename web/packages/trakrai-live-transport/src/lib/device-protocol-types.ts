'use client';

import type { TransportPacket } from './live-types';

export type DeviceProtocolPacketFilter = Readonly<{
  service?: string | null;
  subtopics?: readonly string[];
  types?: readonly string[];
}>;

export type DeviceProtocolRequestOptions<TPayload extends Record<string, unknown>> = Readonly<{
  command: string;
  payload?: TPayload;
  requestId?: string;
  responseSubtopics?: readonly string[];
  responseTypes?: readonly string[];
  service?: string | null;
  subtopic?: string;
  timeoutMs?: number;
}>;

export type DeviceProtocolNotifyOptions<TPayload extends Record<string, unknown>> = Readonly<{
  payload?: TPayload;
  service?: string | null;
  subtopic?: string;
  type: string;
}>;

export type DeviceProtocolResponse<TPayload = unknown> = Readonly<{
  packet: TransportPacket;
  payload: TPayload;
  requestId: string;
  responseType: string | null;
}>;

export class DeviceProtocolRequestError<TPayload = unknown> extends Error {
  readonly packet: TransportPacket | null;
  readonly payload: TPayload | null;
  readonly requestId: string;
  readonly responseType: string | null;

  constructor(
    message: string,
    options: Readonly<{
      packet?: TransportPacket | null;
      payload?: TPayload | null;
      requestId: string;
      responseType?: string | null;
    }>,
  ) {
    super(message);
    this.name = 'DeviceProtocolRequestError';
    this.packet = options.packet ?? null;
    this.payload = options.payload ?? null;
    this.requestId = options.requestId;
    this.responseType = options.responseType ?? null;
  }
}

export const isDeviceProtocolRequestError = (
  value: unknown,
): value is DeviceProtocolRequestError<unknown> => value instanceof DeviceProtocolRequestError;
