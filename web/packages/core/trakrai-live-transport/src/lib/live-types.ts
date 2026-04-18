'use client';

export type TransportLayer = 'cloud' | 'edge';

export type TransportConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'starting'
  | 'streaming'
  | 'reconnecting';

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

export type DeviceStatus = {
  cameras: DeviceCamera[];
  deviceId?: string;
  services?: Record<string, DeviceServiceStatus>;
  uptime: number;
};

export type ActivityLogEntry = {
  at: string;
  id: string;
  level: 'error' | 'info' | 'warn';
  message: string;
};

export type TransportEnvelope = {
  msgId?: string;
  payload?: unknown;
  timestamp?: string;
  type: string;
};

export type TransportPacket = {
  deviceId: string;
  envelope: TransportEnvelope;
  service: string | null;
  subtopic: string;
};

export type TransportPacketDraft = {
  msgId?: string;
  payload?: unknown;
  service?: string | null;
  subtopic: string;
  timestamp?: string;
  type: string;
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

export type WebRtcConnectionState = 'idle' | 'starting' | 'streaming';

export type WebRtcEvent =
  | { cameraName: string | null; sessionId: string | null; type: 'offer-received' }
  | { type: 'track-attached' }
  | { type: 'peer-connected' }
  | { type: 'peer-temporarily-disconnected' }
  | { reason: 'closed' | 'failed' | 'timeout'; type: 'peer-closed' }
  | { message: string; type: 'error' };
