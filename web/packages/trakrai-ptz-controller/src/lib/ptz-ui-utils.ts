'use client';

import type { PtzCapabilities, PtzPosition, PtzVelocityCommand } from './ptz-types';

const PTZ_LIMIT_EPSILON = 0.01;
const PTZ_METRIC_DECIMALS = 3;
const PTZ_PAN_TILT_SPEED = 0.55;

export const DEFAULT_ZOOM_TARGET = 0.25;
export const PTZ_ZOOM_MIN = 0;
export const PTZ_ZOOM_MAX = 1;
export const PTZ_ZOOM_STEP = 0.01;
export const PTZ_ZOOM_HOLD_SPEED = 0.45;

export const PTZ_BUTTON_BASE_CLASSES =
  'touch-none border transition disabled:cursor-not-allowed disabled:opacity-40';
export const PTZ_BUTTON_ACTIVE_CLASSES = 'border-primary/40 bg-primary/10 text-primary';
export const PTZ_BUTTON_INACTIVE_CLASSES =
  'border-border bg-background hover:border-foreground/20 hover:bg-muted/50';
const STOP_BUTTON_CLASSES =
  'bg-card border-border text-foreground border transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40';

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

export const formatSignedMetric = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'N/A' : value.toFixed(PTZ_METRIC_DECIMALS);

export const formatUpdatedAt = (updatedAt: string | null | undefined): string => {
  if (updatedAt === null || updatedAt === undefined || updatedAt.trim() === '') {
    return 'Not yet sampled';
  }

  return new Date(updatedAt).toLocaleTimeString();
};

export const getPtzStopButtonClasses = (): string => STOP_BUTTON_CLASSES;

const isRangeAvailable = (
  range: PtzCapabilities['panRange'] | PtzCapabilities['tiltRange'] | PtzCapabilities['zoomRange'],
): range is NonNullable<typeof range> =>
  range !== null &&
  range !== undefined &&
  Number.isFinite(range.min) &&
  Number.isFinite(range.max) &&
  range.max >= range.min;

export const supportsPanTiltDrive = (capabilities: PtzCapabilities | null | undefined): boolean =>
  capabilities === null || capabilities === undefined || capabilities.canContinuousPanTilt === true;

export const supportsZoomDrive = (capabilities: PtzCapabilities | null | undefined): boolean =>
  capabilities === null || capabilities === undefined || capabilities.canContinuousZoom === true;

export const supportsZoomTarget = (capabilities: PtzCapabilities | null | undefined): boolean =>
  capabilities === null || capabilities === undefined || capabilities.canAbsoluteZoom === true;

export const supportsGoHome = (capabilities: PtzCapabilities | null | undefined): boolean =>
  capabilities === null || capabilities === undefined || capabilities.canGoHome === true;

const isDirectionBlockedByRange = (
  currentValue: number | null | undefined,
  range: PtzCapabilities['panRange'] | PtzCapabilities['tiltRange'] | PtzCapabilities['zoomRange'],
  delta: number,
): boolean => {
  if (
    !isRangeAvailable(range) ||
    currentValue === null ||
    currentValue === undefined ||
    delta === 0
  ) {
    return false;
  }

  if (delta > 0) {
    return currentValue >= range.max - PTZ_LIMIT_EPSILON;
  }

  return currentValue <= range.min + PTZ_LIMIT_EPSILON;
};

export const canStartPtzMove = (
  direction: PtzDirection,
  capabilities: PtzCapabilities | null | undefined,
  position: PtzPosition | null | undefined,
): boolean => {
  if (capabilities === null || capabilities === undefined) {
    return true;
  }

  if (direction.velocity.zoom !== 0) {
    if (!supportsZoomDrive(capabilities)) {
      return false;
    }

    return !isDirectionBlockedByRange(
      position?.zoom,
      capabilities.zoomRange,
      direction.velocity.zoom,
    );
  }

  if (!supportsPanTiltDrive(capabilities)) {
    return false;
  }

  const panBlocked = isDirectionBlockedByRange(
    position?.pan,
    capabilities.panRange,
    direction.velocity.pan,
  );
  const tiltBlocked = isDirectionBlockedByRange(
    position?.tilt,
    capabilities.tiltRange,
    direction.velocity.tilt,
  );

  return !panBlocked && !tiltBlocked;
};

export const toNormalizedZoomValue = (
  value: number | null | undefined,
  capabilities: PtzCapabilities | null | undefined,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const range = capabilities?.zoomRange;
  if (!isRangeAvailable(range) || range.max === range.min) {
    return clamp(value, PTZ_ZOOM_MIN, PTZ_ZOOM_MAX);
  }

  return clamp((value - range.min) / (range.max - range.min), PTZ_ZOOM_MIN, PTZ_ZOOM_MAX);
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};
