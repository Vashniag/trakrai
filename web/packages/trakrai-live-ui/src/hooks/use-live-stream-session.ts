'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConnectionState, StreamStats } from '../lib/live-types';

import { LiveTransportClient } from '../lib/live-client';
import {
  BITS_PER_BYTE,
  DISCONNECT_GRACE_MS,
  MS_PER_SECOND,
  STATS_INTERVAL_MS,
  getEnvelopeType,
  normalizeEndpointUrl,
  normalizeOptionalString,
  readStatBoolean,
  readStatNumber,
  readStatString,
  unwrapPayload,
  type BufferedIceCandidate,
  type IceConfigResponse,
  type StatsSnapshot,
} from '../lib/live-transport-utils';

export type LiveStreamSessionConfig = Readonly<{
  cameraName: string;
  deviceId: string;
  enabled: boolean;
  httpBaseUrl: string;
  signalingUrl: string;
}>;

export type LiveStreamSessionState = Readonly<{
  activeCameraName: string | null;
  connectionState: ConnectionState;
  error: string | null;
  stream: MediaStream | null;
  streamStats: StreamStats | null;
}>;

export const useLiveStreamSession = ({
  cameraName,
  deviceId,
  enabled,
  httpBaseUrl,
  signalingUrl,
}: LiveStreamSessionConfig): LiveStreamSessionState => {
  const normalizedCameraName = cameraName.trim();
  const normalizedDeviceId = deviceId.trim();
  const normalizedHttpBaseUrl = normalizeEndpointUrl(httpBaseUrl);
  const normalizedSignalingUrl = normalizeEndpointUrl(signalingUrl);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [activeCameraName, setActiveCameraName] = useState<string | null>(null);

  const liveGatewayRef = useRef<LiveTransportClient | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceCandidateBuffer = useRef<BufferedIceCandidate[]>([]);
  const activeRequestIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const pendingSessionIdRef = useRef<string | null>(null);
  const requestedCameraRef = useRef<string | null>(null);
  const lastStatsSnapshotRef = useRef<StatsSnapshot | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);

  const cleanupPc = useCallback((clearSession: boolean) => {
    if (disconnectTimerRef.current !== null) {
      window.clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }

    if (pcRef.current !== null) {
      pcRef.current.close();
      pcRef.current = null;
    }

    iceCandidateBuffer.current = [];
    lastStatsSnapshotRef.current = null;
    setStream(null);
    setStreamStats(null);

    if (clearSession) {
      activeRequestIdRef.current = null;
      activeSessionIdRef.current = null;
      pendingSessionIdRef.current = null;
      setActiveCameraName(null);
    }
  }, []);

  const collectStats = useCallback(async () => {
    const peerConnection = pcRef.current;
    if (peerConnection === null) {
      return;
    }

    const stats = await peerConnection.getStats();
    const statsEntries = Array.from(stats.values()) as RTCStats[];
    let inboundVideo: RTCStats | null = null;
    let candidatePair: RTCStats | null = null;
    let codec: RTCStats | null = null;
    let remoteCandidate: RTCStats | null = null;

    for (const stat of statsEntries) {
      if (stat.type === 'inbound-rtp') {
        const mediaKind = readStatString(stat, 'kind') ?? readStatString(stat, 'mediaType');
        const isRemote = readStatBoolean(stat, 'isRemote');
        if (mediaKind === 'video' && isRemote !== true) {
          inboundVideo = stat;
        }
      }

      if (stat.type === 'candidate-pair') {
        const nextCandidatePair = stat;
        if (
          readStatString(nextCandidatePair, 'state') === 'succeeded' &&
          (candidatePair === null || readStatBoolean(nextCandidatePair, 'nominated') === true)
        ) {
          candidatePair = nextCandidatePair;
        }
      }
    }

    const codecId = inboundVideo !== null ? readStatString(inboundVideo, 'codecId') : null;
    if (codecId !== null) {
      codec = (stats.get(codecId) as RTCStats | undefined) ?? null;
    }

    const remoteCandidateId =
      candidatePair !== null ? readStatString(candidatePair, 'remoteCandidateId') : null;
    if (remoteCandidateId !== null) {
      remoteCandidate = (stats.get(remoteCandidateId) as RTCStats | undefined) ?? null;
    }

    const currentSnapshot =
      inboundVideo !== null
        ? {
            bytesReceived: readStatNumber(inboundVideo, 'bytesReceived') ?? 0,
            framesDecoded:
              readStatNumber(inboundVideo, 'framesDecoded') ??
              readStatNumber(inboundVideo, 'framesReceived'),
            timestamp: inboundVideo.timestamp,
          }
        : null;

    const previousSnapshot = lastStatsSnapshotRef.current;
    let bitrateKbps: number | null = null;
    let calculatedFps: number | null = null;
    if (currentSnapshot !== null && previousSnapshot !== null) {
      const bytesDelta = currentSnapshot.bytesReceived - previousSnapshot.bytesReceived;
      const durationMs = currentSnapshot.timestamp - previousSnapshot.timestamp;
      if (bytesDelta >= 0 && durationMs > 0) {
        bitrateKbps = Number(((bytesDelta * BITS_PER_BYTE) / durationMs).toFixed(1));
      }

      if (
        currentSnapshot.framesDecoded !== null &&
        previousSnapshot.framesDecoded !== null &&
        durationMs > 0
      ) {
        const framesDelta = currentSnapshot.framesDecoded - previousSnapshot.framesDecoded;
        if (framesDelta >= 0) {
          calculatedFps = Number(((framesDelta * MS_PER_SECOND) / durationMs).toFixed(1));
        }
      }
    }

    if (currentSnapshot !== null) {
      lastStatsSnapshotRef.current = currentSnapshot;
    }

    setStreamStats({
      bitrateKbps,
      bytesReceived: inboundVideo !== null ? readStatNumber(inboundVideo, 'bytesReceived') : null,
      candidateType:
        remoteCandidate !== null ? readStatString(remoteCandidate, 'candidateType') : null,
      codec: codec !== null ? readStatString(codec, 'mimeType') : null,
      fps:
        calculatedFps ??
        (inboundVideo !== null ? readStatNumber(inboundVideo, 'framesPerSecond') : null),
      frameHeight: inboundVideo !== null ? readStatNumber(inboundVideo, 'frameHeight') : null,
      frameWidth: inboundVideo !== null ? readStatNumber(inboundVideo, 'frameWidth') : null,
      jitterMs:
        inboundVideo !== null && readStatNumber(inboundVideo, 'jitter') !== null
          ? Number(((readStatNumber(inboundVideo, 'jitter') ?? 0) * MS_PER_SECOND).toFixed(1))
          : null,
      packetsLost: inboundVideo !== null ? readStatNumber(inboundVideo, 'packetsLost') : null,
      roundTripTimeMs:
        candidatePair !== null && readStatNumber(candidatePair, 'currentRoundTripTime') !== null
          ? Number(
              (
                (readStatNumber(candidatePair, 'currentRoundTripTime') ?? 0) * MS_PER_SECOND
              ).toFixed(1),
            )
          : null,
      transport: remoteCandidate !== null ? readStatString(remoteCandidate, 'protocol') : null,
    });
  }, []);

  const stopRequestedStream = useCallback(
    (clearState: boolean) => {
      liveGatewayRef.current?.send('stop-live', {
        sessionId: activeSessionIdRef.current ?? pendingSessionIdRef.current ?? undefined,
      });
      requestedCameraRef.current = null;
      cleanupPc(true);
      setError(null);
      if (clearState) {
        setConnectionState('connected');
      }
    },
    [cleanupPc],
  );

  const startRequestedStream = useCallback(
    (nextCameraName: string) => {
      const trimmedCameraName = nextCameraName.trim();
      if (trimmedCameraName === '' || liveGatewayRef.current === null) {
        return;
      }

      const hasExistingSession =
        activeRequestIdRef.current !== null ||
        activeSessionIdRef.current !== null ||
        pendingSessionIdRef.current !== null;
      if (
        requestedCameraRef.current === trimmedCameraName &&
        hasExistingSession &&
        (connectionState === 'starting' || connectionState === 'streaming')
      ) {
        return;
      }

      if (hasExistingSession && requestedCameraRef.current !== trimmedCameraName) {
        stopRequestedStream(false);
      }

      requestedCameraRef.current = trimmedCameraName;
      activeRequestIdRef.current = crypto.randomUUID();
      pendingSessionIdRef.current = null;
      setError(null);
      setConnectionState('starting');
      setActiveCameraName(trimmedCameraName);
      liveGatewayRef.current.send('start-live', {
        cameraName: trimmedCameraName,
        requestId: activeRequestIdRef.current,
      });
    },
    [connectionState, stopRequestedStream],
  );

  const handleSdpOffer = useCallback(
    async (payload: {
      cameraName?: string;
      requestId?: string;
      sdp: string;
      sessionId?: string;
    }) => {
      const offeredRequestId = normalizeOptionalString(payload.requestId);
      if (
        offeredRequestId !== null &&
        activeRequestIdRef.current !== null &&
        offeredRequestId !== activeRequestIdRef.current
      ) {
        return;
      }

      const offeredSessionId = normalizeOptionalString(payload.sessionId);
      const expectedSessionId = pendingSessionIdRef.current ?? activeSessionIdRef.current;
      if (
        offeredSessionId !== null &&
        expectedSessionId !== null &&
        offeredSessionId !== expectedSessionId
      ) {
        return;
      }

      try {
        const nextSessionId =
          offeredSessionId ?? pendingSessionIdRef.current ?? crypto.randomUUID();
        cleanupPc(false);
        activeSessionIdRef.current = nextSessionId;
        pendingSessionIdRef.current = nextSessionId;
        setError(null);
        setConnectionState('starting');
        setActiveCameraName(
          normalizeOptionalString(payload.cameraName) ?? requestedCameraRef.current,
        );

        const iceResponse = await fetch(`${normalizedHttpBaseUrl}/api/ice-config`, {
          cache: 'no-store',
        });
        if (!iceResponse.ok) {
          throw new Error(`ICE config request failed with ${iceResponse.status}`);
        }

        const iceConfig = (await iceResponse.json()) as IceConfigResponse;
        const peerConnection = new RTCPeerConnection(iceConfig);
        pcRef.current = peerConnection;

        peerConnection.ontrack = (event) => {
          if (pcRef.current !== peerConnection) {
            return;
          }

          setStream(event.streams[0] ?? new MediaStream([event.track]));
        };

        peerConnection.onicecandidate = (event) => {
          if (event.candidate !== null) {
            liveGatewayRef.current?.send('ice-candidate', {
              candidate: event.candidate.toJSON(),
              sessionId: nextSessionId,
            });
          }
        };

        peerConnection.onconnectionstatechange = () => {
          if (pcRef.current !== peerConnection) {
            return;
          }

          switch (peerConnection.connectionState) {
            case 'new':
            case 'connecting':
              if (disconnectTimerRef.current !== null) {
                window.clearTimeout(disconnectTimerRef.current);
                disconnectTimerRef.current = null;
              }
              break;
            case 'connected':
              if (disconnectTimerRef.current !== null) {
                window.clearTimeout(disconnectTimerRef.current);
                disconnectTimerRef.current = null;
              }
              setConnectionState('streaming');
              setError(null);
              break;
            case 'disconnected':
              if (disconnectTimerRef.current !== null) {
                window.clearTimeout(disconnectTimerRef.current);
              }
              setError('Media connection interrupted. Waiting to recover...');
              disconnectTimerRef.current = window.setTimeout(() => {
                if (pcRef.current !== peerConnection) {
                  return;
                }
                if (peerConnection.connectionState !== 'disconnected') {
                  return;
                }
                setConnectionState('connected');
                setError('WebRTC connection lost');
                cleanupPc(true);
              }, DISCONNECT_GRACE_MS);
              break;
            case 'failed':
            case 'closed':
              if (disconnectTimerRef.current !== null) {
                window.clearTimeout(disconnectTimerRef.current);
                disconnectTimerRef.current = null;
              }
              setConnectionState('connected');
              setError('WebRTC connection lost');
              cleanupPc(true);
              break;
            default:
              break;
          }
        };

        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({ sdp: payload.sdp, type: 'offer' }),
        );

        for (const bufferedCandidate of iceCandidateBuffer.current) {
          if (
            bufferedCandidate.sessionId !== null &&
            bufferedCandidate.sessionId !== nextSessionId
          ) {
            continue;
          }

          await peerConnection.addIceCandidate(new RTCIceCandidate(bufferedCandidate.candidate));
        }
        iceCandidateBuffer.current = [];

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        liveGatewayRef.current?.send('sdp-answer', {
          sdp: answer.sdp,
          sessionId: nextSessionId,
        });
        void collectStats();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'WebRTC setup failed');
        cleanupPc(true);
      }
    },
    [cleanupPc, collectStats, normalizedHttpBaseUrl],
  );

  const handleIceCandidate = useCallback(
    async (payload: { candidate: RTCIceCandidateInit; requestId?: string; sessionId?: string }) => {
      const candidateRequestId = normalizeOptionalString(payload.requestId);
      if (
        candidateRequestId !== null &&
        activeRequestIdRef.current !== null &&
        candidateRequestId !== activeRequestIdRef.current
      ) {
        return;
      }

      const sessionId = normalizeOptionalString(payload.sessionId);
      if (
        sessionId !== null &&
        activeSessionIdRef.current !== null &&
        sessionId !== activeSessionIdRef.current
      ) {
        return;
      }

      const peerConnection = pcRef.current;
      if (peerConnection?.remoteDescription != null) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
        return;
      }

      iceCandidateBuffer.current.push({
        candidate: payload.candidate,
        sessionId,
      });
    },
    [],
  );

  useEffect(() => {
    if (
      normalizedDeviceId === '' ||
      normalizedHttpBaseUrl === '' ||
      normalizedSignalingUrl === ''
    ) {
      cleanupPc(true);
      setConnectionState('disconnected');
      setError(null);
      return undefined;
    }

    const liveGateway = new LiveTransportClient(
      `${normalizedSignalingUrl}?deviceId=${encodeURIComponent(normalizedDeviceId)}`,
    );
    liveGatewayRef.current = liveGateway;

    const unsubscribeMessages = liveGateway.onMessage((message) => {
      switch (message.type) {
        case 'session-info':
        case 'device-status':
          setConnectionState((currentState) =>
            currentState === 'starting' || currentState === 'streaming'
              ? currentState
              : 'connected',
          );
          break;
        case 'device-response': {
          const responseType = getEnvelopeType(message.payload);
          if (responseType === 'start-live-ack') {
            const payload = unwrapPayload<{
              cameraName?: string;
              error?: string;
              ok?: boolean;
              requestId?: string;
              sessionId?: string;
            }>(message.payload);
            const acknowledgedRequestId = normalizeOptionalString(payload.requestId);
            if (
              acknowledgedRequestId !== null &&
              activeRequestIdRef.current !== null &&
              acknowledgedRequestId !== activeRequestIdRef.current
            ) {
              return;
            }

            if (payload.ok === false || payload.error !== undefined) {
              setError(payload.error ?? 'Device rejected the live start request');
              setConnectionState('connected');
              cleanupPc(true);
              return;
            }

            pendingSessionIdRef.current = normalizeOptionalString(payload.sessionId);
            if (acknowledgedRequestId !== null) {
              activeRequestIdRef.current = acknowledgedRequestId;
            }
            setActiveCameraName(
              normalizeOptionalString(payload.cameraName) ?? requestedCameraRef.current,
            );
            setConnectionState('starting');
          }

          if (responseType === 'service-unavailable') {
            const payload = unwrapPayload<{ error?: string }>(message.payload);
            if (typeof payload.error === 'string' && payload.error.trim() !== '') {
              setError(payload.error);
            }
          }
          break;
        }
        case 'sdp-offer':
          void handleSdpOffer(
            unwrapPayload<{
              cameraName?: string;
              requestId?: string;
              sdp: string;
              sessionId?: string;
            }>(message.payload),
          );
          break;
        case 'ice-candidate':
          void handleIceCandidate(
            unwrapPayload<{
              candidate: RTCIceCandidateInit;
              requestId?: string;
              sessionId?: string;
            }>(message.payload),
          );
          break;
        default:
          break;
      }
    });

    const unsubscribeStatus = liveGateway.onStatus((event) => {
      switch (event.type) {
        case 'connecting':
          setConnectionState((currentState) => {
            if (currentState === 'streaming') {
              return currentState;
            }

            return event.attempt > 1 ? 'reconnecting' : 'connecting';
          });
          break;
        case 'open':
          setConnectionState((currentState) =>
            currentState === 'streaming' ? currentState : 'connected',
          );
          setError(null);
          if (enabled && normalizedCameraName !== '') {
            startRequestedStream(normalizedCameraName);
          }
          break;
        case 'reconnect-scheduled':
        case 'closed':
          setConnectionState((currentState) =>
            currentState === 'disconnected' ? currentState : 'reconnecting',
          );
          break;
        case 'error':
          setError(event.message ?? 'Gateway transport error');
          break;
        default:
          break;
      }
    });

    liveGateway.connect();

    return () => {
      if (
        activeRequestIdRef.current !== null ||
        activeSessionIdRef.current !== null ||
        pendingSessionIdRef.current !== null
      ) {
        liveGateway.send('stop-live', {
          sessionId: activeSessionIdRef.current ?? pendingSessionIdRef.current ?? undefined,
        });
      }
      unsubscribeMessages();
      unsubscribeStatus();
      liveGateway.disconnect();
      liveGatewayRef.current = null;
      cleanupPc(true);
      setStreamStats(null);
    };
  }, [
    cleanupPc,
    enabled,
    handleIceCandidate,
    handleSdpOffer,
    normalizedCameraName,
    normalizedDeviceId,
    normalizedHttpBaseUrl,
    normalizedSignalingUrl,
    startRequestedStream,
  ]);

  useEffect(() => {
    if (
      connectionState !== 'starting' &&
      connectionState !== 'streaming' &&
      pcRef.current === null
    ) {
      setStreamStats(null);
      lastStatsSnapshotRef.current = null;
      return undefined;
    }

    void collectStats();
    const timer = window.setInterval(() => {
      void collectStats();
    }, STATS_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [collectStats, connectionState]);

  useEffect(() => {
    if (!enabled || normalizedCameraName === '') {
      if (
        activeRequestIdRef.current !== null ||
        activeSessionIdRef.current !== null ||
        pendingSessionIdRef.current !== null
      ) {
        stopRequestedStream(true);
      } else if (pcRef.current !== null) {
        cleanupPc(true);
      }

      if (normalizedDeviceId !== '' && normalizedSignalingUrl !== '') {
        setConnectionState((currentState) =>
          currentState === 'connecting' || currentState === 'reconnecting'
            ? currentState
            : 'connected',
        );
      }
      return;
    }

    startRequestedStream(normalizedCameraName);
  }, [
    cleanupPc,
    enabled,
    normalizedCameraName,
    normalizedDeviceId,
    normalizedSignalingUrl,
    startRequestedStream,
    stopRequestedStream,
  ]);

  const resolvedConnectionState =
    normalizedDeviceId === '' || normalizedSignalingUrl === '' ? 'disconnected' : connectionState;

  return {
    activeCameraName,
    connectionState: resolvedConnectionState,
    error,
    stream,
    streamStats,
  };
};
