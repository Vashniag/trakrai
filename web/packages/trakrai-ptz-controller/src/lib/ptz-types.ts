'use client';

import type {
  PtzControl_CommandAckPayload,
  PtzControl_GetStatus_Output,
  PtzControl_PtzCapabilities,
  PtzControl_PtzRange,
  PtzControl_VelocityCommand,
} from '@trakrai/live-transport/generated-contracts/ptz_control';

export type PtzCapabilities = PtzControl_PtzCapabilities;
export type PtzMoveStatus = Readonly<{
  panTilt?: string | null;
  zoom?: string | null;
}>;
export type PtzRange = PtzControl_PtzRange | null;
export type PtzPosition = Readonly<{
  capabilities?: PtzCapabilities | null;
  cameraName: string;
  moveStatus?: PtzMoveStatus | null;
  pan: number;
  tilt: number;
  updatedAt?: string | null;
  zoom: number;
}>;
export type PtzTargetPosition = Pick<PtzPosition, 'pan' | 'tilt' | 'zoom'>;
export type PtzVelocityCommand = PtzControl_VelocityCommand;
export type PtzCommandAckPayload = PtzControl_CommandAckPayload;
export type PtzStatusPayload = PtzControl_GetStatus_Output;

export type PtzState = Readonly<{
  activeCamera: string | null;
  capabilities: PtzCapabilities | null;
  configuredCameras: string[];
  lastCommand: string | null;
  lastError: string | null;
  position: PtzPosition | null;
  status: string | null;
}>;
