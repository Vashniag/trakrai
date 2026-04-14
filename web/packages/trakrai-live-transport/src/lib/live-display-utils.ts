'use client';

import type { ConnectionState, DeviceServiceStatus } from './live-types';

const FRESH_HEARTBEAT_SECONDS = 5;
const SECONDS_PER_MINUTE = 60;

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
    typeof details['frameSource'] === 'string' && details['frameSource'] !== ''
      ? `${details['frameSource']} frames`
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
    typeof details['sessionCount'] === 'number' ? `${details['sessionCount']} live sessions` : null,
    Array.isArray(details['configuredCameras']) && details['configuredCameras'].length > 0
      ? `ptz ${details['configuredCameras'].length} cams`
      : null,
  ].filter((fragment): fragment is string => fragment !== null);

  return fragments.length > 0 ? fragments.join(' | ') : null;
};
