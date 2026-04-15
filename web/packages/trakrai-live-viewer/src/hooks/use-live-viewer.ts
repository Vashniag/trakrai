'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDeviceService } from '@trakrai/live-transport/hooks/use-device-service';
import {
  createClientRequestId,
  normalizeOptionalString,
} from '@trakrai/live-transport/lib/live-transport-utils';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';
import { useWebRtc } from '@trakrai/webrtc/providers/webrtc-provider';

import type { LiveFrameSource, LiveLayoutSelection } from '../lib/live-viewer-types';
import type {
  ConnectionState,
  DeviceStatus,
  StreamStats,
  TransportConnectionState,
  TransportLayer,
  WebRtcEvent,
  WebRtcConnectionState,
} from '@trakrai/live-transport/lib/live-types';

import {
  createLiveViewerRequestId,
  getReportedLiveFeedCamera,
  LIVE_VIEWER_SERVICE_NAME,
} from '../lib/live-viewer-transport';

const DEFAULT_LIVE_FRAME_SOURCE: LiveFrameSource = 'raw';

type StartLiveResponsePayload = Readonly<{
  cameraName?: string;
  error?: string;
  ok?: boolean;
  requestId?: string;
  sessionId?: string;
}>;

type LiveLayoutUpdatedPayload = Readonly<{
  cameraName?: string;
  frameSource?: string;
  layoutMode?: string;
  requestId?: string;
  sessionId?: string;
}>;

type WebRtcOfferPayload = Readonly<{
  cameraName?: string;
  requestId?: string;
  sdp: string;
  sessionId?: string;
}>;

type WebRtcIcePayload = Readonly<{
  candidate: RTCIceCandidateInit;
  requestId?: string;
  sessionId?: string;
}>;

export type LiveViewerState = {
  activeCameraName: string | null;
  connectionState: ConnectionState;
  deviceStatus: DeviceStatus | null;
  error: string | null;
  heartbeatAgeSeconds: number | null;
  isBusy: boolean;
  refreshStatus: () => void;
  startLive: (selection: LiveLayoutSelection) => void;
  stopLive: () => void;
  stream: MediaStream | null;
  streamStats: StreamStats | null;
  transport: {
    httpBaseUrl: string;
    signalingUrl: string;
    transportMode: TransportLayer;
  };
  updateLiveLayout: (selection: LiveLayoutSelection) => void;
};

const normalizeLiveFrameSource = (
  frameSource: LiveFrameSource | null | undefined,
): LiveFrameSource => (frameSource === 'processed' ? 'processed' : DEFAULT_LIVE_FRAME_SOURCE);

const normalizeLiveLayoutSelection = (selection: LiveLayoutSelection): LiveLayoutSelection => {
  const cameraNames: string[] = [];
  for (const candidate of selection.cameraNames) {
    const normalizedCameraName = normalizeOptionalString(candidate);
    if (normalizedCameraName === null || cameraNames.includes(normalizedCameraName)) {
      continue;
    }

    cameraNames.push(normalizedCameraName);
  }

  return {
    cameraNames,
    frameSource: normalizeLiveFrameSource(selection.frameSource),
    mode: selection.mode,
  };
};

const mapTransportStateToConnectionState = (
  transportState: TransportConnectionState,
): ConnectionState => {
  switch (transportState) {
    case 'disconnected':
      return 'disconnected';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'connected':
      return 'connected';
  }
};

export const useLiveViewer = (): LiveViewerState => {
  const liveFeedService = useDeviceService(LIVE_VIEWER_SERVICE_NAME);
  const {
    appendLog,
    deviceId,
    deviceStatus,
    heartbeatAgeSeconds,
    httpBaseUrl,
    requestDeviceStatus,
    runtimeError,
    signalingUrl,
    transportError,
    transportMode,
    transportState,
  } = useLiveTransport();
  const {
    closePeer,
    currentSessionId,
    handleRemoteIceCandidate,
    handleSdpOffer,
    stream,
    streamError,
    streamStats,
    subscribeToEvents,
  } = useWebRtc();

  const [viewerState, setViewerState] = useState<WebRtcConnectionState>('idle');
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [activeCameraName, setActiveCameraName] = useState<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const pendingSessionIdRef = useRef<string | null>(null);
  const requestedCameraRef = useRef<string | null>(null);

  useEffect(() => {
    if (deviceId !== '') {
      return;
    }

    activeRequestIdRef.current = null;
    pendingSessionIdRef.current = null;
    requestedCameraRef.current = null;
  }, [deviceId]);

  useEffect(() => {
    const unsubscribeOffer = liveFeedService.subscribe<WebRtcOfferPayload>(
      ({ payload }) => {
        const offeredRequestId = normalizeOptionalString(payload.requestId);
        if (
          offeredRequestId !== null &&
          activeRequestIdRef.current !== null &&
          offeredRequestId !== activeRequestIdRef.current
        ) {
          appendLog('warn', `Ignoring SDP offer for another request ${offeredRequestId}`);
          return;
        }

        const offeredSessionId = normalizeOptionalString(payload.sessionId);
        const expectedSessionId = pendingSessionIdRef.current ?? currentSessionId;
        if (
          offeredSessionId !== null &&
          expectedSessionId !== null &&
          offeredSessionId !== expectedSessionId
        ) {
          appendLog('warn', `Ignoring stale SDP offer for session ${offeredSessionId}`);
          return;
        }

        void handleSdpOffer({
          cameraName: payload.cameraName,
          sdp: payload.sdp,
          sendSignal: (type: 'ice-candidate' | 'sdp-answer', signalPayload: unknown) => {
            if (type === 'sdp-answer') {
              liveFeedService.notify('sdp-answer', signalPayload as Record<string, unknown>, {
                subtopic: 'webrtc/answer',
              });
              return;
            }

            liveFeedService.notify('ice-candidate', signalPayload as Record<string, unknown>, {
              subtopic: 'webrtc/ice',
            });
          },
          sessionId: payload.sessionId,
        });
      },
      {
        subtopics: ['webrtc/offer'],
        types: ['sdp-offer'],
      },
    );

    const unsubscribeIce = liveFeedService.subscribe<WebRtcIcePayload>(
      ({ payload }) => {
        const candidateRequestId = normalizeOptionalString(payload.requestId);
        if (
          candidateRequestId !== null &&
          activeRequestIdRef.current !== null &&
          candidateRequestId !== activeRequestIdRef.current
        ) {
          return;
        }

        void handleRemoteIceCandidate({
          candidate: payload.candidate,
          sessionId: payload.sessionId,
        });
      },
      {
        subtopics: ['webrtc/ice'],
        types: ['ice-candidate'],
      },
    );

    return () => {
      unsubscribeOffer();
      unsubscribeIce();
    };
  }, [appendLog, currentSessionId, handleRemoteIceCandidate, handleSdpOffer, liveFeedService]);

  useEffect(() => {
    const unsubscribeEvents = subscribeToEvents((event: WebRtcEvent) => {
      switch (event.type) {
        case 'offer-received':
          setViewerState('starting');
          setViewerError(null);
          pendingSessionIdRef.current = event.sessionId;
          setActiveCameraName(event.cameraName ?? requestedCameraRef.current);
          appendLog(
            'info',
            `Received SDP offer${event.cameraName !== null ? ` for ${event.cameraName}` : ''}`,
          );
          break;
        case 'track-attached':
          appendLog('info', 'Remote media track attached');
          break;
        case 'peer-connected':
          setViewerState('streaming');
          setViewerError(null);
          appendLog('info', 'Peer connection established');
          break;
        case 'peer-temporarily-disconnected':
          setViewerError('Media connection interrupted. Waiting to recover...');
          appendLog('warn', 'Peer connection temporarily disconnected');
          break;
        case 'peer-closed':
          setViewerState('idle');
          setViewerError('WebRTC connection lost');
          setActiveCameraName(null);
          pendingSessionIdRef.current = null;
          activeRequestIdRef.current = null;
          appendLog('warn', 'Peer connection did not recover in time');
          break;
        case 'error':
          setViewerState('idle');
          setViewerError(event.message);
          setActiveCameraName(null);
          pendingSessionIdRef.current = null;
          activeRequestIdRef.current = null;
          appendLog('error', event.message);
          break;
        default:
          break;
      }
    });

    return () => {
      unsubscribeEvents();
    };
  }, [appendLog, subscribeToEvents]);

  const startLive = useCallback(
    (selection: LiveLayoutSelection) => {
      const normalizedSelection = normalizeLiveLayoutSelection(selection);
      const primaryCameraName = normalizedSelection.cameraNames[0] ?? null;
      if (primaryCameraName === null) {
        return;
      }

      const previousSessionId = currentSessionId ?? pendingSessionIdRef.current;
      if (previousSessionId !== null) {
        liveFeedService.notify('stop-live', {
          sessionId: previousSessionId,
        });
        closePeer({ clearSession: true });
      }

      requestedCameraRef.current = primaryCameraName;
      activeRequestIdRef.current = createLiveViewerRequestId();
      pendingSessionIdRef.current = null;
      setViewerError(null);
      setViewerState('starting');
      setActiveCameraName(primaryCameraName);
      appendLog(
        'info',
        `Requesting ${normalizedSelection.frameSource} ${normalizedSelection.mode} live view with ${
          normalizedSelection.cameraNames.length
        } camera${normalizedSelection.cameraNames.length === 1 ? '' : 's'}`,
      );
      void liveFeedService
        .request<
          {
            cameraName: string | null;
            cameraNames: string[];
            frameSource: LiveFrameSource;
            layoutMode: LiveLayoutSelection['mode'];
          },
          StartLiveResponsePayload
        >(
          'start-live',
          {
            cameraName: normalizedSelection.cameraNames[0] ?? null,
            cameraNames: normalizedSelection.cameraNames,
            frameSource: normalizedSelection.frameSource,
            layoutMode: normalizedSelection.mode,
          },
          {
            requestId: activeRequestIdRef.current,
            responseSubtopics: ['response'],
            responseTypes: ['start-live-ack'],
          },
        )
        .then((response) => {
          const { payload } = response;
          if (payload.ok === false || payload.error !== undefined) {
            const errorMessage = payload.error ?? 'Device rejected the live start request';
            setViewerError(errorMessage);
            setViewerState('idle');
            appendLog('error', errorMessage);
            closePeer({ clearSession: true });
            return undefined;
          }

          const acknowledgedCameraName = normalizeOptionalString(payload.cameraName);
          pendingSessionIdRef.current = normalizeOptionalString(payload.sessionId);
          activeRequestIdRef.current = response.requestId;
          setActiveCameraName(acknowledgedCameraName ?? requestedCameraRef.current);
          setViewerState('starting');
          appendLog(
            'info',
            `Device acknowledged live start${
              acknowledgedCameraName !== null ? ` for ${acknowledgedCameraName}` : ''
            }`,
          );
          return undefined;
        })
        .catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message : 'Device rejected the live start request';
          setViewerError(errorMessage);
          setViewerState('idle');
          appendLog('error', errorMessage);
          closePeer({ clearSession: true });
        });
    },
    [appendLog, closePeer, currentSessionId, liveFeedService],
  );

  const updateLiveLayout = useCallback(
    (selection: LiveLayoutSelection) => {
      const normalizedSelection = normalizeLiveLayoutSelection(selection);
      const primaryCameraName = normalizedSelection.cameraNames[0] ?? null;
      if (primaryCameraName === null) {
        return;
      }

      const sessionId = currentSessionId ?? pendingSessionIdRef.current;
      if (sessionId === null) {
        startLive(normalizedSelection);
        return;
      }

      requestedCameraRef.current = primaryCameraName;
      setActiveCameraName(primaryCameraName);
      setViewerError(null);
      const requestId = createClientRequestId();
      activeRequestIdRef.current = requestId;
      appendLog(
        'info',
        `Updating live layout to ${normalizedSelection.frameSource} ${normalizedSelection.mode} (${normalizedSelection.cameraNames.length} cameras)`,
      );
      void liveFeedService
        .request<
          {
            cameraName: string | null;
            cameraNames: string[];
            frameSource: LiveFrameSource;
            layoutMode: LiveLayoutSelection['mode'];
            sessionId: string;
          },
          LiveLayoutUpdatedPayload
        >(
          'update-live-layout',
          {
            cameraName: normalizedSelection.cameraNames[0] ?? null,
            cameraNames: normalizedSelection.cameraNames,
            frameSource: normalizedSelection.frameSource,
            layoutMode: normalizedSelection.mode,
            sessionId,
          },
          {
            requestId,
            responseSubtopics: ['response'],
            responseTypes: ['live-layout-updated'],
          },
        )
        .then((response) => {
          const nextCameraName = normalizeOptionalString(response.payload.cameraName);
          if (nextCameraName !== null) {
            setActiveCameraName(nextCameraName);
          }
          pendingSessionIdRef.current =
            normalizeOptionalString(response.payload.sessionId) ?? pendingSessionIdRef.current;
          activeRequestIdRef.current = response.requestId;
          appendLog(
            'info',
            `Live layout updated${
              typeof response.payload.layoutMode === 'string' &&
              response.payload.layoutMode.trim() !== ''
                ? ` to ${response.payload.layoutMode}`
                : ''
            }`,
          );
          return undefined;
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : 'Live layout update failed';
          setViewerError(errorMessage);
          appendLog('error', errorMessage);
        });
    },
    [appendLog, currentSessionId, liveFeedService, startLive],
  );

  const stopLive = useCallback(() => {
    appendLog('info', 'Stopping live feed');
    liveFeedService.notify('stop-live', {
      sessionId: currentSessionId ?? pendingSessionIdRef.current ?? undefined,
    });
    requestedCameraRef.current = null;
    pendingSessionIdRef.current = null;
    activeRequestIdRef.current = null;
    closePeer({ clearSession: true });
    setViewerState('idle');
    setActiveCameraName(null);
    requestDeviceStatus();
  }, [appendLog, closePeer, currentSessionId, liveFeedService, requestDeviceStatus]);

  const refreshStatus = useCallback(() => {
    appendLog('info', 'Requesting latest device status');
    requestDeviceStatus();
  }, [appendLog, requestDeviceStatus]);

  let resolvedConnectionState: ConnectionState;
  if (deviceId === '') {
    resolvedConnectionState = 'disconnected';
  } else if (viewerState === 'starting') {
    resolvedConnectionState = 'starting';
  } else if (viewerState === 'streaming') {
    resolvedConnectionState = 'streaming';
  } else {
    resolvedConnectionState = mapTransportStateToConnectionState(transportState);
  }

  const reportedActiveCameraName =
    deviceStatus === null ? null : getReportedLiveFeedCamera(deviceStatus);
  const resolvedActiveCameraName =
    deviceId === '' ? null : (activeCameraName ?? reportedActiveCameraName);
  const resolvedStream = deviceId === '' ? null : stream;
  const resolvedStreamStats = deviceId === '' ? null : streamStats;
  const error =
    deviceId === '' ? null : (viewerError ?? streamError ?? runtimeError ?? transportError);
  const isBusy =
    resolvedConnectionState === 'connecting' ||
    resolvedConnectionState === 'starting' ||
    resolvedConnectionState === 'reconnecting';

  return useMemo(
    () => ({
      activeCameraName: resolvedActiveCameraName,
      connectionState: resolvedConnectionState,
      deviceStatus,
      error,
      heartbeatAgeSeconds,
      isBusy,
      refreshStatus,
      startLive,
      stopLive,
      stream: resolvedStream,
      streamStats: resolvedStreamStats,
      transport: {
        httpBaseUrl,
        signalingUrl,
        transportMode,
      },
      updateLiveLayout,
    }),
    [
      deviceStatus,
      error,
      heartbeatAgeSeconds,
      httpBaseUrl,
      isBusy,
      refreshStatus,
      resolvedConnectionState,
      resolvedActiveCameraName,
      resolvedStream,
      resolvedStreamStats,
      signalingUrl,
      startLive,
      stopLive,
      transportMode,
      updateLiveLayout,
    ],
  );
};
