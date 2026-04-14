'use client';

import {
  normalizeOptionalString,
  unwrapPayload,
} from '@trakrai/live-transport/lib/live-transport-utils';

import type { PtzCapabilities, PtzPosition, PtzState } from './ptz-types';
import type {
  DeviceServiceStatus,
  TransportPacket,
  TransportPacketDraft,
} from '@trakrai/live-transport/lib/live-types';

export const PTZ_SERVICE_NAME = 'ptz-control';

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

export const readPtzPosition = (value: unknown): PtzPosition | null => {
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

export const isPtzPacket = (packet: TransportPacket): boolean =>
  (packet.service ?? '') === PTZ_SERVICE_NAME;

export const createPtzCommandPacket = (
  type: string,
  payload: Record<string, unknown>,
): TransportPacketDraft => ({
  payload,
  service: PTZ_SERVICE_NAME,
  subtopic: 'command',
  type,
});

export const readPtzResponsePayload = <TPayload>(packet: TransportPacket): TPayload =>
  unwrapPayload<TPayload>(packet.envelope);
