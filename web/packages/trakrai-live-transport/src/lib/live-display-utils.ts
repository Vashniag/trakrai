'use client';

import type { ConnectionState, DeviceServiceStatus } from './live-types';

const FRESH_HEARTBEAT_SECONDS = 5;
const MAX_SERVICE_DETAIL_FRAGMENTS = 4;
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

const summarizeDetailValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const normalizedValue = value.trim();
    return normalizedValue === '' ? null : normalizedValue;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((entry) => summarizeDetailValue(entry))
      .filter((entry): entry is string => entry !== null);
    if (normalizedItems.length === 0) {
      return null;
    }

    return normalizedItems.join(', ');
  }

  return null;
};

export const formatServiceDetails = (details: DeviceServiceStatus['details']): string | null => {
  if (details === undefined) {
    return null;
  }

  const fragments = Object.entries(details)
    .filter(([key]) => key !== 'sessions')
    .map(([key, value]) => {
      const summary = summarizeDetailValue(value);
      return summary === null ? null : `${key}: ${summary}`;
    })
    .filter((fragment): fragment is string => fragment !== null)
    .slice(0, MAX_SERVICE_DETAIL_FRAGMENTS);

  return fragments.length > 0 ? fragments.join(' | ') : null;
};
