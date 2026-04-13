'use client';

import type {
  ActivityLogEntry,
  PtzCapabilities,
  DeviceServiceStatus,
  DeviceStatus,
  PtzPosition,
  PtzState,
} from './live-types';

export type IceConfigResponse = {
  iceServers: RTCIceServer[];
};

type LiveEnvelope<TPayload> = {
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

export const unwrapPayload = <TPayload>(envelope: unknown): TPayload => {
  if (
    typeof envelope === 'object' &&
    envelope !== null &&
    'payload' in envelope &&
    (envelope as LiveEnvelope<TPayload>).payload !== undefined
  ) {
    return (envelope as LiveEnvelope<TPayload>).payload as TPayload;
  }

  return envelope as TPayload;
};

export const getEnvelopeType = (payload: unknown): string | null => {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'type' in payload &&
    typeof (payload as LiveEnvelope<unknown>).type === 'string'
  ) {
    return (payload as LiveEnvelope<unknown>).type ?? null;
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
  level,
  message,
});

export const getReportedLiveFeedCamera = (status: DeviceStatus): string | null => {
  const camera = status.services?.['live-feed']?.details?.['camera'];
  return typeof camera === 'string' && camera.trim() !== '' ? camera.trim() : null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
        .map((entry) => entry.trim())
    : [];

const readFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readPtzRange = (value: unknown) => {
  const range = asRecord(value);
  if (range === null) {
    return null;
  }

  const min = readFiniteNumber(range['min']);
  const max = readFiniteNumber(range['max']);
  if (min === null || max === null) {
    return null;
  }

  return { max, min };
};

const readPtzCapabilities = (value: unknown): PtzCapabilities | null => {
  const capabilities = asRecord(value);
  if (capabilities === null) {
    return null;
  }

  return {
    canAbsolutePanTilt: capabilities['canAbsolutePanTilt'] === true,
    canAbsoluteZoom: capabilities['canAbsoluteZoom'] === true,
    canContinuousPanTilt: capabilities['canContinuousPanTilt'] === true,
    canContinuousZoom: capabilities['canContinuousZoom'] === true,
    canGoHome: capabilities['canGoHome'] === true,
    panRange: readPtzRange(capabilities['panRange']),
    tiltRange: readPtzRange(capabilities['tiltRange']),
    zoomRange: readPtzRange(capabilities['zoomRange']),
  };
};

const readPtzPosition = (value: unknown): PtzPosition | null => {
  const position = asRecord(value);
  if (position === null) {
    return null;
  }

  const cameraName =
    typeof position['cameraName'] === 'string' && position['cameraName'].trim() !== ''
      ? position['cameraName'].trim()
      : null;
  const pan = readFiniteNumber(position['pan']);
  const tilt = readFiniteNumber(position['tilt']);
  const zoom = readFiniteNumber(position['zoom']);

  if (cameraName === null || pan === null || tilt === null || zoom === null) {
    return null;
  }

  const moveStatusValue = asRecord(position['moveStatus']);
  const moveStatus =
    moveStatusValue === null
      ? null
      : {
          panTilt:
            typeof moveStatusValue['panTilt'] === 'string' ? moveStatusValue['panTilt'] : null,
          zoom: typeof moveStatusValue['zoom'] === 'string' ? moveStatusValue['zoom'] : null,
        };

  return {
    capabilities: readPtzCapabilities(position['capabilities']),
    cameraName,
    moveStatus,
    pan,
    tilt,
    updatedAt:
      typeof position['updatedAt'] === 'string' && position['updatedAt'].trim() !== ''
        ? position['updatedAt'].trim()
        : null,
    zoom,
  };
};

export const readPtzState = (serviceStatus: DeviceServiceStatus | undefined): PtzState | null => {
  if (serviceStatus === undefined) {
    return null;
  }

  const details = asRecord(serviceStatus.details ?? null);
  const position = details !== null ? readPtzPosition(details['position']) : null;

  return {
    activeCamera:
      details !== null && typeof details['activeCamera'] === 'string'
        ? normalizeOptionalString(details['activeCamera'])
        : null,
    capabilities: readPtzCapabilities(details?.['capabilities']) ?? position?.capabilities ?? null,
    configuredCameras: details !== null ? readStringArray(details['configuredCameras']) : [],
    lastCommand:
      details !== null && typeof details['lastCommand'] === 'string'
        ? normalizeOptionalString(details['lastCommand'])
        : null,
    lastError:
      details !== null && typeof details['lastError'] === 'string'
        ? normalizeOptionalString(details['lastError'])
        : null,
    position,
    status: serviceStatus.status,
  };
};
