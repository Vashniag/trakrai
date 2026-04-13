'use client';

import type { ConnectionState, DeviceServiceStatus, PtzVelocityCommand } from './live-view-types';

const FRESH_HEARTBEAT_SECONDS = 5;
const SECONDS_PER_MINUTE = 60;
const PTZ_METRIC_DECIMALS = 3;
const PTZ_PAN_TILT_SPEED = 0.55;

export const DEFAULT_DEVICE_ID = 'hacklab@10.8.0.50';
export const DEFAULT_ZOOM_TARGET = 0.25;
export const PTZ_ZOOM_MIN = 0;
export const PTZ_ZOOM_MAX = 1;
export const PTZ_ZOOM_STEP = 0.01;
export const PTZ_ZOOM_HOLD_SPEED = 0.45;

export const PTZ_BUTTON_BASE_CLASSES =
  'touch-none border transition disabled:cursor-not-allowed disabled:opacity-40';
export const PTZ_BUTTON_ACTIVE_CLASSES = 'border-emerald-500 bg-emerald-50 text-emerald-700';
export const PTZ_BUTTON_INACTIVE_CLASSES =
  'border-border bg-background hover:border-foreground/20 hover:bg-muted/50';
const STOP_BUTTON_CLASSES =
  'border-border border bg-neutral-950 text-white transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40';

export type PtzDirection = Readonly<{
  id: string;
  label: string;
  shortLabel: string;
  velocity: PtzVelocityCommand;
}>;

type PtzDirectionLayoutItem = PtzDirection | 'stop';

const createDirection = (
  id: string,
  label: string,
  shortLabel: string,
  velocity: PtzVelocityCommand,
): PtzDirection => ({
  id,
  label,
  shortLabel,
  velocity,
});

const UP_LEFT = createDirection('up-left', 'Up left', 'UL', {
  pan: -PTZ_PAN_TILT_SPEED,
  tilt: PTZ_PAN_TILT_SPEED,
  zoom: 0,
});
const UP = createDirection('up', 'Up', 'UP', {
  pan: 0,
  tilt: PTZ_PAN_TILT_SPEED,
  zoom: 0,
});
const UP_RIGHT = createDirection('up-right', 'Up right', 'UR', {
  pan: PTZ_PAN_TILT_SPEED,
  tilt: PTZ_PAN_TILT_SPEED,
  zoom: 0,
});
const LEFT = createDirection('left', 'Left', 'LT', {
  pan: -PTZ_PAN_TILT_SPEED,
  tilt: 0,
  zoom: 0,
});
const RIGHT = createDirection('right', 'Right', 'RT', {
  pan: PTZ_PAN_TILT_SPEED,
  tilt: 0,
  zoom: 0,
});
const DOWN_LEFT = createDirection('down-left', 'Down left', 'DL', {
  pan: -PTZ_PAN_TILT_SPEED,
  tilt: -PTZ_PAN_TILT_SPEED,
  zoom: 0,
});
const DOWN = createDirection('down', 'Down', 'DN', {
  pan: 0,
  tilt: -PTZ_PAN_TILT_SPEED,
  zoom: 0,
});
const DOWN_RIGHT = createDirection('down-right', 'Down right', 'DR', {
  pan: PTZ_PAN_TILT_SPEED,
  tilt: -PTZ_PAN_TILT_SPEED,
  zoom: 0,
});

export const PTZ_DIRECTION_LAYOUT: ReadonlyArray<ReadonlyArray<PtzDirectionLayoutItem>> = [
  [UP_LEFT, UP, UP_RIGHT],
  [LEFT, 'stop', RIGHT],
  [DOWN_LEFT, DOWN, DOWN_RIGHT],
];

export const PTZ_ZOOM_DIRECTIONS: ReadonlyArray<PtzDirection> = [
  createDirection('zoom-in', 'Zoom in', 'IN', { pan: 0, tilt: 0, zoom: PTZ_ZOOM_HOLD_SPEED }),
  createDirection('zoom-out', 'Zoom out', 'OUT', {
    pan: 0,
    tilt: 0,
    zoom: -PTZ_ZOOM_HOLD_SPEED,
  }),
];

export const getStatusLabel = (connectionState: ConnectionState): string => {
  switch (connectionState) {
    case 'disconnected':
      return 'Disconnected';
    case 'starting':
      return 'Starting';
    case 'streaming':
      return 'Streaming';
    case 'reconnecting':
      return 'Reconnecting';
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    default:
      return 'Connected';
  }
};

export const getStatusClasses = (connectionState: ConnectionState): string => {
  switch (connectionState) {
    case 'connected':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-600';
    case 'disconnected':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-600';
    case 'streaming':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600';
    case 'starting':
    case 'connecting':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-600';
    case 'reconnecting':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-600';
    default:
      return 'border-amber-500/30 bg-amber-500/10 text-amber-600';
  }
};

export const formatHeartbeatAge = (heartbeatAgeSeconds: number | null): string => {
  if (heartbeatAgeSeconds === null) {
    return 'Waiting for heartbeat';
  }

  if (heartbeatAgeSeconds < FRESH_HEARTBEAT_SECONDS) {
    return 'Just now';
  }

  return `${heartbeatAgeSeconds}s ago`;
};

export const formatUptime = (uptimeSeconds: number | undefined): string => {
  if (uptimeSeconds === undefined) {
    return 'Unknown';
  }

  return `${Math.floor(uptimeSeconds / SECONDS_PER_MINUTE)}m`;
};

export const formatMetric = (value: number | null | undefined, suffix: string): string =>
  value === null || value === undefined ? 'N/A' : `${value}${suffix}`;

export const formatSignedMetric = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'N/A' : value.toFixed(PTZ_METRIC_DECIMALS);

export const formatUpdatedAt = (updatedAt: string | null | undefined): string => {
  if (updatedAt === null || updatedAt === undefined || updatedAt.trim() === '') {
    return 'Not yet sampled';
  }

  return new Date(updatedAt).toLocaleTimeString();
};

export const getServiceStatusClasses = (status: string): string => {
  switch (status) {
    case 'streaming':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
    case 'negotiating':
    case 'starting':
    case 'running':
    case 'moving':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
    case 'idle':
    case 'registered':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700';
    default:
      return 'border-rose-500/30 bg-rose-500/10 text-rose-700';
  }
};

export const formatServiceDetails = (details: DeviceServiceStatus['details']): string | null => {
  if (details === undefined) {
    return null;
  }

  const fragments = [
    typeof details['camera'] === 'string' && details['camera'] !== ''
      ? `camera ${details['camera']}`
      : null,
    typeof details['peerConnection'] === 'string' && details['peerConnection'] !== ''
      ? `peer ${details['peerConnection']}`
      : null,
    typeof details['phase'] === 'string' && details['phase'] !== '' ? `${details['phase']}` : null,
    typeof details['reason'] === 'string' && details['reason'] !== ''
      ? `reason ${details['reason']}`
      : null,
    typeof details['error'] === 'string' && details['error'] !== ''
      ? `error ${details['error']}`
      : null,
    Array.isArray(details['configuredCameras']) && details['configuredCameras'].length > 0
      ? `ptz ${details['configuredCameras'].length} cams`
      : null,
  ].filter((fragment): fragment is string => fragment !== null);

  return fragments.length > 0 ? fragments.join(' | ') : null;
};

export const getPtzStopButtonClasses = (): string => STOP_BUTTON_CLASSES;
