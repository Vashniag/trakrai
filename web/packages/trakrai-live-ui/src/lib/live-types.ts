'use client';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'starting'
  | 'streaming'
  | 'reconnecting';

export type LiveLayoutMode = 'single' | 'grid-4' | 'grid-9' | 'focus-8' | 'grid-16';
export type LiveFrameSource = 'raw' | 'processed';

export type LiveLayoutSelection = {
  cameraNames: string[];
  frameSource: LiveFrameSource;
  mode: LiveLayoutMode;
};

export type DeviceCamera = {
  enabled: boolean;
  name: string;
  pipeline?: string;
};

export type DeviceServiceStatus = {
  details?: Record<string, unknown>;
  service: string;
  status: string;
};

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

export type DeviceStatus = {
  cameras: DeviceCamera[];
  deviceId?: string;
  services?: Record<string, DeviceServiceStatus>;
  uptime: number;
};

export type ActivityLogEntry = {
  at: string;
  level: 'error' | 'info' | 'warn';
  message: string;
};

export type StreamStats = {
  bitrateKbps: number | null;
  bytesReceived: number | null;
  candidateType: string | null;
  codec: string | null;
  fps: number | null;
  frameHeight: number | null;
  frameWidth: number | null;
  jitterMs: number | null;
  packetsLost: number | null;
  roundTripTimeMs: number | null;
  transport: string | null;
};
