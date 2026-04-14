'use client';

import {
  createClientRequestId,
  normalizeOptionalString,
  unwrapPayload,
} from '@trakrai/live-transport/lib/live-transport-utils';

import type { LiveLayoutSelection } from './live-viewer-types';
import type {
  DeviceStatus,
  TransportPacket,
  TransportPacketDraft,
} from '@trakrai/live-transport/lib/live-types';

export const LIVE_VIEWER_SERVICE_NAME = 'live-feed';

export const createLiveViewerRequestId = (): string => createClientRequestId();

export const createStartLivePacket = (
  selection: LiveLayoutSelection,
  requestId: string,
): TransportPacketDraft => ({
  payload: {
    cameraName: selection.cameraNames[0] ?? null,
    cameraNames: selection.cameraNames,
    frameSource: selection.frameSource,
    layoutMode: selection.mode,
    requestId,
  },
  service: LIVE_VIEWER_SERVICE_NAME,
  subtopic: 'command',
  type: 'start-live',
});

export const createUpdateLiveLayoutPacket = (
  selection: LiveLayoutSelection,
  sessionId: string,
): TransportPacketDraft => ({
  payload: {
    cameraName: selection.cameraNames[0] ?? null,
    cameraNames: selection.cameraNames,
    frameSource: selection.frameSource,
    layoutMode: selection.mode,
    sessionId,
  },
  service: LIVE_VIEWER_SERVICE_NAME,
  subtopic: 'command',
  type: 'update-live-layout',
});

export const createStopLivePacket = (
  sessionId: string | null | undefined,
): TransportPacketDraft => ({
  payload: {
    sessionId: sessionId ?? undefined,
  },
  service: LIVE_VIEWER_SERVICE_NAME,
  subtopic: 'command',
  type: 'stop-live',
});

export const createWebRtcAnswerPacket = (
  payload: Record<string, unknown>,
): TransportPacketDraft => ({
  payload,
  service: LIVE_VIEWER_SERVICE_NAME,
  subtopic: 'webrtc/answer',
  type: 'sdp-answer',
});

export const createWebRtcIcePacket = (payload: Record<string, unknown>): TransportPacketDraft => ({
  payload,
  service: LIVE_VIEWER_SERVICE_NAME,
  subtopic: 'webrtc/ice',
  type: 'ice-candidate',
});

export const isLiveViewerPacket = (packet: TransportPacket): boolean =>
  (packet.service ?? '') === LIVE_VIEWER_SERVICE_NAME;

export const getReportedLiveFeedCamera = (status: DeviceStatus): string | null => {
  const camera = status.services?.[LIVE_VIEWER_SERVICE_NAME]?.details?.['camera'];
  return typeof camera === 'string' && camera.trim() !== '' ? camera.trim() : null;
};

export const readLiveViewerRequestId = (packet: TransportPacket): string | null => {
  const payload = unwrapPayload<Record<string, unknown>>(packet.envelope);
  return normalizeOptionalString(typeof payload.requestId === 'string' ? payload.requestId : null);
};

export const readLiveViewerSessionId = (packet: TransportPacket): string | null => {
  const payload = unwrapPayload<Record<string, unknown>>(packet.envelope);
  return normalizeOptionalString(typeof payload.sessionId === 'string' ? payload.sessionId : null);
};
