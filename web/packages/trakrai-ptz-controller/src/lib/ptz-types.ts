'use client';

export type PtzVelocityCommand = {
  pan: number;
  tilt: number;
  zoom: number;
};

export type PtzMoveStatus = {
  panTilt?: string | null;
  zoom?: string | null;
};

export type PtzRange = {
  max: number;
  min: number;
};

export type PtzCapabilities = {
  canAbsolutePanTilt: boolean;
  canAbsoluteZoom: boolean;
  canContinuousPanTilt: boolean;
  canContinuousZoom: boolean;
  canGoHome: boolean;
  panRange?: PtzRange | null;
  tiltRange?: PtzRange | null;
  zoomRange?: PtzRange | null;
};

export type PtzPosition = {
  capabilities?: PtzCapabilities | null;
  cameraName: string;
  moveStatus?: PtzMoveStatus | null;
  pan: number;
  tilt: number;
  updatedAt?: string | null;
  zoom: number;
};

export type PtzState = {
  activeCamera: string | null;
  capabilities?: PtzCapabilities | null;
  configuredCameras: string[];
  lastCommand: string | null;
  lastError: string | null;
  position: PtzPosition | null;
  status: string | null;
};

export type PtzTargetPosition = {
  pan: number;
  tilt: number;
  zoom: number;
};
