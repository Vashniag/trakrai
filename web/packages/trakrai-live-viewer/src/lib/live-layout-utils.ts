'use client';

import type { LiveLayoutMode } from './live-viewer-types';
import type { DeviceCamera } from '@trakrai/live-transport/lib/live-types';

export type LiveLayoutOption = Readonly<{
  capacity: number;
  description: string;
  label: string;
  mode: LiveLayoutMode;
  shortLabel: string;
}>;

export const LIVE_LAYOUT_OPTIONS: readonly LiveLayoutOption[] = [
  {
    capacity: 1,
    description: 'Single camera',
    label: 'Single',
    mode: 'single',
    shortLabel: '1',
  },
  {
    capacity: 4,
    description: '2x2 grid',
    label: 'Quad',
    mode: 'grid-4',
    shortLabel: '4',
  },
  {
    capacity: 8,
    description: 'One large and seven support tiles',
    label: 'Focus',
    mode: 'focus-8',
    shortLabel: '1+7',
  },
  {
    capacity: 9,
    description: '3x3 grid',
    label: 'Nine',
    mode: 'grid-9',
    shortLabel: '9',
  },
  {
    capacity: 16,
    description: '4x4 grid',
    label: 'Sixteen',
    mode: 'grid-16',
    shortLabel: '16',
  },
] as const;

const LIVE_LAYOUT_CAPACITY_BY_MODE: Record<LiveLayoutMode, number> = {
  'focus-8': 8,
  'grid-16': 16,
  'grid-4': 4,
  'grid-9': 9,
  single: 1,
};

export const getLiveLayoutCapacity = (mode: LiveLayoutMode): number =>
  LIVE_LAYOUT_CAPACITY_BY_MODE[mode];

export const clampLiveLayoutStartIndex = (
  startIndex: number,
  totalCameraCount: number,
  mode: LiveLayoutMode,
): number => {
  const capacity = getLiveLayoutCapacity(mode);
  if (totalCameraCount <= capacity) {
    return 0;
  }

  const maxStartIndex = Math.max(0, totalCameraCount - capacity);
  return Math.min(Math.max(0, startIndex), maxStartIndex);
};

export const getVisibleLayoutCameras = (
  cameras: readonly DeviceCamera[],
  startIndex: number,
  mode: LiveLayoutMode,
): DeviceCamera[] => {
  const capacity = getLiveLayoutCapacity(mode);
  const safeStartIndex = clampLiveLayoutStartIndex(startIndex, cameras.length, mode);
  return cameras.slice(safeStartIndex, safeStartIndex + capacity);
};

export const getLiveLayoutPageCount = (totalCameraCount: number, mode: LiveLayoutMode): number => {
  const capacity = getLiveLayoutCapacity(mode);
  return Math.max(1, Math.ceil(totalCameraCount / capacity));
};

export const getLiveLayoutPageLabel = (
  visibleCameras: readonly DeviceCamera[],
  totalCameraCount: number,
  startIndex: number,
  mode: LiveLayoutMode,
): string => {
  if (visibleCameras.length === 0 || totalCameraCount === 0) {
    return 'No cameras';
  }

  const safeStartIndex = clampLiveLayoutStartIndex(startIndex, totalCameraCount, mode);
  const rangeStart = safeStartIndex + 1;
  const rangeEnd = safeStartIndex + visibleCameras.length;
  const pageIndex = Math.floor(safeStartIndex / getLiveLayoutCapacity(mode)) + 1;
  const pageCount = getLiveLayoutPageCount(totalCameraCount, mode);

  return `${rangeStart}-${rangeEnd} of ${totalCameraCount} (set ${pageIndex}/${pageCount})`;
};
