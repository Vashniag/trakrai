'use client';

import type { ActivityLogEntry } from './live-types';

export type IceConfigResponse = {
  iceServers: RTCIceServer[];
};

type TransportEnvelope<TPayload> = {
  payload?: TPayload;
  type?: string;
};

export type BufferedIceCandidate = {
  candidate: RTCIceCandidateInit;
  sessionId: string | null;
};

export type StatsSnapshot = {
  bytesReceived: number;
  framesDecoded: number | null;
  timestamp: number;
};

export const HEARTBEAT_INTERVAL_MS = 1000;
export const LOG_LIMIT = 60;
export const BITS_PER_BYTE = 8;
export const MS_PER_SECOND = 1000;
export const STALE_HEARTBEAT_SECONDS = 15;
export const STATS_INTERVAL_MS = 1000;
export const DISCONNECT_GRACE_MS = 12_000;

const REQUEST_ID_RADIX = 36;
let fallbackRequestCounter = 0;
let fallbackLogEntryCounter = 0;

export const createClientRequestId = (): string => {
  const randomUuid = globalThis.crypto.randomUUID;
  if (typeof randomUuid === 'function') {
    return randomUuid.call(globalThis.crypto);
  }

  fallbackRequestCounter += 1;
  return `trakrai-${Date.now().toString(REQUEST_ID_RADIX)}-${fallbackRequestCounter.toString(
    REQUEST_ID_RADIX,
  )}`;
};

export const unwrapPayload = <TPayload>(envelope: unknown): TPayload => {
  if (
    typeof envelope === 'object' &&
    envelope !== null &&
    'payload' in envelope &&
    (envelope as TransportEnvelope<TPayload>).payload !== undefined
  ) {
    return (envelope as TransportEnvelope<TPayload>).payload as TPayload;
  }

  return envelope as TPayload;
};

export const getEnvelopeType = (payload: unknown): string | null => {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'type' in payload &&
    typeof (payload as TransportEnvelope<unknown>).type === 'string'
  ) {
    return (payload as TransportEnvelope<unknown>).type ?? null;
  }

  return null;
};

export const normalizeEndpointUrl = (url: string): string =>
  url
    .replace(/\s+(?=[?#]|$)/g, '')
    .trim()
    .replace(/\/$/, '');

export const normalizeOptionalString = (value: string | null | undefined): string | null => {
  const normalizedValue = value?.trim();
  return normalizedValue !== undefined && normalizedValue !== '' ? normalizedValue : null;
};

const readStatValue = (stat: RTCStats, key: string): unknown =>
  (stat as unknown as Record<string, unknown>)[key];

export const readStatString = (stat: RTCStats, key: string): string | null => {
  const value = readStatValue(stat, key);
  return typeof value === 'string' ? value : null;
};

export const readStatNumber = (stat: RTCStats, key: string): number | null => {
  const value = readStatValue(stat, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const readStatBoolean = (stat: RTCStats, key: string): boolean | null => {
  const value = readStatValue(stat, key);
  return typeof value === 'boolean' ? value : null;
};

export const createLogEntry = (
  level: ActivityLogEntry['level'],
  message: string,
): ActivityLogEntry => ({
  at: new Date().toISOString(),
  id: `log-${Date.now().toString(REQUEST_ID_RADIX)}-${(fallbackLogEntryCounter++).toString(
    REQUEST_ID_RADIX,
  )}`,
  level,
  message,
});
