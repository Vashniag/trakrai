'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDeviceRuntime } from '@trakrai/live-transport/hooks/use-device-runtime';
import { useLiveTransport } from '@trakrai/live-transport/hooks/use-live-transport';
import { useWebRtc } from '@trakrai/live-transport/hooks/use-webrtc';
import {
  createClientRequestId,
  getEnvelopeType,
  getReportedLiveFeedCamera,
  normalizeOptionalString,
  unwrapPayload,
} from '@trakrai/live-transport/lib/live-transport-utils';

import type {
  ConnectionState,
  DeviceStatus,
  LiveFrameSource,
  LiveLayoutSelection,
  StreamStats,
  TransportConnectionState,
  TransportLayer,
  WebRtcConnectionState,
} from '@trakrai/live-transport/lib/live-types';

const DEFAULT_LIVE_FRAME_SOURCE: LiveFrameSource = 'raw';
const ICE_CANDIDATE_MESSAGE_TYPE = 'ice-candidate';

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
  const {
    deviceId,
    httpBaseUrl,
    requestStatus,
    sendMessage,
    signalingUrl,
    subscribeToMessages,
    transportError,
    transportMode,
    transportState,
  } = useLiveTransport();
  const { appendLog, deviceStatus, heartbeatAgeSeconds, runtimeError } = useDeviceRuntime();
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
    const unsubscribeMessages = subscribeToMessages((message) => {
      switch (message.type) {
        case 'device-status': {
          const nextStatus = unwrapPayload<DeviceStatus>(message.payload);
          const reportedCamera = getReportedLiveFeedCamera(nextStatus);
          if (reportedCamera !== null) {
            setActiveCameraName(reportedCamera);
          }
          break;
        }
        case 'device-response': {
          const payload = unwrapPayload<{
            cameraName?: string;
            error?: string;
            ok?: boolean;
            requestId?: string;
            sessionId?: string;
          }>(message.payload);
          const responseType = getEnvelopeType(message.payload) ?? undefined;

          if (responseType === 'status') {
            const nextStatus = unwrapPayload<DeviceStatus>(message.payload);
            const reportedCamera = getReportedLiveFeedCamera(nextStatus);
            if (reportedCamera !== null) {
              setActiveCameraName(reportedCamera);
            }
            return;
          }

          if (responseType === 'start-live-ack') {
            const acknowledgedRequestId =
              typeof payload.requestId === 'string'
                ? normalizeOptionalString(payload.requestId)
                : null;
            if (
              acknowledgedRequestId !== null &&
              activeRequestIdRef.current !== null &&
              acknowledgedRequestId !== activeRequestIdRef.current
            ) {
              return;
            }

            if (payload.ok === false || payload.error !== undefined) {
              setViewerError(payload.error ?? 'Device rejected the live start request');
              setViewerState('idle');
              appendLog('error', payload.error ?? 'Device rejected the live start request');
              closePeer({ clearSession: true });
              return;
            }

            const acknowledgedCameraName = normalizeOptionalString(payload.cameraName);
            pendingSessionIdRef.current = normalizeOptionalString(payload.sessionId);
            if (acknowledgedRequestId !== null) {
              activeRequestIdRef.current = acknowledgedRequestId;
            }
            setActiveCameraName(acknowledgedCameraName ?? requestedCameraRef.current);
            setViewerState('starting');
            appendLog(
              'info',
              `Device acknowledged live start${
                acknowledgedCameraName !== null ? ` for ${acknowledgedCameraName}` : ''
              }`,
            );
          }

          if (responseType === 'live-layout-updated') {
            const layoutPayload = unwrapPayload<{
              cameraName?: string;
              layoutMode?: string;
            }>(message.payload);
            const nextCameraName = normalizeOptionalString(layoutPayload.cameraName);
            if (nextCameraName !== null) {
              setActiveCameraName(nextCameraName);
            }
            appendLog(
              'info',
              `Live layout updated${
                typeof layoutPayload.layoutMode === 'string' &&
                layoutPayload.layoutMode.trim() !== ''
                  ? ` to ${layoutPayload.layoutMode}`
                  : ''
              }`,
            );
          }

          if (responseType === 'service-unavailable' && payload.error !== undefined) {
            setViewerError(payload.error);
            appendLog('error', payload.error);
          }
          break;
        }
        case 'sdp-offer': {
          const payload = unwrapPayload<{
            cameraName?: string;
            requestId?: string;
            sdp: string;
            sessionId?: string;
          }>(message.payload);
          const offeredRequestId =
            typeof payload.requestId === 'string'
              ? normalizeOptionalString(payload.requestId)
              : null;
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
            sendSignal: (type, signalPayload) => {
              sendMessage(type, signalPayload);
            },
            sessionId: payload.sessionId,
          });
          break;
        }
        case ICE_CANDIDATE_MESSAGE_TYPE: {
          const payload = unwrapPayload<{
            candidate: RTCIceCandidateInit;
            requestId?: string;
            sessionId?: string;
          }>(message.payload);
          const candidateRequestId =
            typeof payload.requestId === 'string'
              ? normalizeOptionalString(payload.requestId)
              : null;
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
          break;
        }
        default:
          break;
      }
    });

    return () => {
      unsubscribeMessages();
    };
  }, [
    appendLog,
    closePeer,
    currentSessionId,
    handleRemoteIceCandidate,
    handleSdpOffer,
    sendMessage,
    subscribeToMessages,
  ]);

  useEffect(() => {
    const unsubscribeEvents = subscribeToEvents((event) => {
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
        sendMessage('stop-live', { sessionId: previousSessionId });
        closePeer({ clearSession: true });
      }

      requestedCameraRef.current = primaryCameraName;
      activeRequestIdRef.current = createClientRequestId();
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
      sendMessage('start-live', {
        cameraName: primaryCameraName,
        cameraNames: normalizedSelection.cameraNames,
        frameSource: normalizedSelection.frameSource,
        layoutMode: normalizedSelection.mode,
        requestId: activeRequestIdRef.current,
      });
    },
    [appendLog, closePeer, currentSessionId, sendMessage],
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
      appendLog(
        'info',
        `Updating live layout to ${normalizedSelection.frameSource} ${normalizedSelection.mode} (${normalizedSelection.cameraNames.length} cameras)`,
      );
      sendMessage('update-live-layout', {
        cameraName: primaryCameraName,
        cameraNames: normalizedSelection.cameraNames,
        frameSource: normalizedSelection.frameSource,
        layoutMode: normalizedSelection.mode,
        sessionId,
      });
    },
    [appendLog, currentSessionId, sendMessage, startLive],
  );

  const stopLive = useCallback(() => {
    appendLog('info', 'Stopping live feed');
    sendMessage('stop-live', {
      sessionId: currentSessionId ?? pendingSessionIdRef.current ?? undefined,
    });
    requestedCameraRef.current = null;
    pendingSessionIdRef.current = null;
    activeRequestIdRef.current = null;
    closePeer({ clearSession: true });
    setViewerState('idle');
    setActiveCameraName(null);
    requestStatus();
  }, [appendLog, closePeer, currentSessionId, requestStatus, sendMessage]);

  const refreshStatus = useCallback(() => {
    appendLog('info', 'Requesting latest device status');
    requestStatus();
  }, [appendLog, requestStatus]);

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

  const resolvedActiveCameraName = deviceId === '' ? null : activeCameraName;
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
      signalingUrl,
      startLive,
      stopLive,
      resolvedActiveCameraName,
      resolvedStream,
      resolvedStreamStats,
      transportMode,
      updateLiveLayout,
    ],
  );
};
