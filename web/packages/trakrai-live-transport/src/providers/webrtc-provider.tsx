'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { StreamStats, WebRtcConnectionState, WebRtcEvent } from '../lib/live-types';

import {
  BITS_PER_BYTE,
  DISCONNECT_GRACE_MS,
  MS_PER_SECOND,
  STATS_INTERVAL_MS,
  createClientRequestId,
  normalizeEndpointUrl,
  normalizeOptionalString,
  readStatBoolean,
  readStatNumber,
  readStatString,
  type BufferedIceCandidate,
  type IceConfigResponse,
  type StatsSnapshot,
} from '../lib/live-transport-utils';

type WebRtcSignalSender = (type: 'ice-candidate' | 'sdp-answer', payload: unknown) => void;

export type WebRtcProviderProps = Readonly<{
  children: ReactNode;
  httpBaseUrl: string;
  iceTransportPolicy?: RTCIceTransportPolicy;
}>;

export type HandleSdpOfferOptions = {
  cameraName?: string | null;
  sdp: string;
  sendSignal: WebRtcSignalSender;
  sessionId?: string | null;
};

export type HandleRemoteIceCandidateOptions = {
  candidate: RTCIceCandidateInit;
  sessionId?: string | null;
};

type WebRtcEventHandler = (event: WebRtcEvent) => void;

export type WebRtcContextValue = {
  closePeer: (options?: { clearSession?: boolean }) => void;
  currentSessionId: string | null;
  handleRemoteIceCandidate: (options: HandleRemoteIceCandidateOptions) => Promise<void>;
  handleSdpOffer: (options: HandleSdpOfferOptions) => Promise<void>;
  peerState: WebRtcConnectionState;
  stream: MediaStream | null;
  streamError: string | null;
  streamStats: StreamStats | null;
  subscribeToEvents: (handler: WebRtcEventHandler) => () => void;
};

const WebRtcContext = createContext<WebRtcContextValue | null>(null);
const WEBRTC_CONNECTION_LOST_MESSAGE = 'WebRTC connection lost';
const PEER_CLOSED_EVENT_TYPE: WebRtcEvent['type'] = 'peer-closed';

export const WebRtcProvider = ({
  children,
  httpBaseUrl,
  iceTransportPolicy = 'all',
}: WebRtcProviderProps) => {
  const normalizedHttpBaseUrl = normalizeEndpointUrl(httpBaseUrl);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [peerState, setPeerState] = useState<WebRtcConnectionState>('idle');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const eventHandlersRef = useRef(new Set<WebRtcEventHandler>());
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const iceCandidateBuffer = useRef<BufferedIceCandidate[]>([]);
  const lastStatsSnapshotRef = useRef<StatsSnapshot | null>(null);

  const emitEvent = useCallback((event: WebRtcEvent) => {
    for (const handler of eventHandlersRef.current) {
      handler(event);
    }
  }, []);

  const cleanupPeer = useCallback(
    (
      clearSession: boolean,
      options?: {
        preserveIceCandidateBuffer?: boolean;
      },
    ) => {
      if (disconnectTimerRef.current !== null) {
        window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }

      if (pcRef.current !== null) {
        pcRef.current.close();
        pcRef.current = null;
      }

      if (options?.preserveIceCandidateBuffer !== true) {
        iceCandidateBuffer.current = [];
      }

      lastStatsSnapshotRef.current = null;
      setStream(null);
      setStreamStats(null);
      setPeerState('idle');

      if (clearSession) {
        setCurrentSessionId(null);
      }
    },
    [],
  );

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

  const handleSdpOffer = useCallback(
    async ({ cameraName, sdp, sendSignal, sessionId }: HandleSdpOfferOptions) => {
      try {
        const nextSessionId = normalizeOptionalString(sessionId) ?? createClientRequestId();
        if (currentSessionId === nextSessionId && pcRef.current !== null) {
          return;
        }

        emitEvent({
          cameraName: normalizeOptionalString(cameraName),
          sessionId: nextSessionId,
          type: 'offer-received',
        });
        cleanupPeer(false, { preserveIceCandidateBuffer: true });
        setCurrentSessionId(nextSessionId);
        setPeerState('starting');
        setStreamError(null);

        const iceResponse = await fetch(`${normalizedHttpBaseUrl}/api/ice-config`, {
          cache: 'no-store',
        });
        if (!iceResponse.ok) {
          throw new Error(`ICE config request failed with ${iceResponse.status}`);
        }
        const iceConfig = (await iceResponse.json()) as IceConfigResponse;
        const peerConnection = new RTCPeerConnection({
          ...iceConfig,
          iceTransportPolicy,
        });
        const pendingLocalIceCandidates: RTCIceCandidateInit[] = [];
        let canSendLocalIceCandidates = false;

        pcRef.current = peerConnection;

        peerConnection.ontrack = (event) => {
          if (pcRef.current !== peerConnection) {
            return;
          }

          setStream(event.streams[0] ?? new MediaStream([event.track]));
          emitEvent({ type: 'track-attached' });
        };

        peerConnection.onicecandidate = (event) => {
          if (event.candidate === null) {
            return;
          }

          const candidate = event.candidate.toJSON();
          if (!canSendLocalIceCandidates) {
            pendingLocalIceCandidates.push(candidate);
            return;
          }

          sendSignal('ice-candidate', {
            candidate,
            sessionId: nextSessionId,
          });
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
              setPeerState('streaming');
              setStreamError(null);
              emitEvent({ type: 'peer-connected' });
              break;
            case 'disconnected':
              if (disconnectTimerRef.current !== null) {
                window.clearTimeout(disconnectTimerRef.current);
              }
              setStreamError('Media connection interrupted. Waiting to recover...');
              emitEvent({ type: 'peer-temporarily-disconnected' });
              disconnectTimerRef.current = window.setTimeout(() => {
                if (pcRef.current !== peerConnection) {
                  return;
                }
                if (peerConnection.connectionState !== 'disconnected') {
                  return;
                }
                setStreamError(WEBRTC_CONNECTION_LOST_MESSAGE);
                emitEvent({ reason: 'timeout', type: PEER_CLOSED_EVENT_TYPE });
                cleanupPeer(true);
              }, DISCONNECT_GRACE_MS);
              break;
            case 'failed':
              setStreamError(WEBRTC_CONNECTION_LOST_MESSAGE);
              emitEvent({ reason: 'failed', type: PEER_CLOSED_EVENT_TYPE });
              cleanupPeer(true);
              break;
            case 'closed':
              emitEvent({ reason: 'closed', type: PEER_CLOSED_EVENT_TYPE });
              cleanupPeer(true);
              break;
            default:
              break;
          }
        };

        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({ sdp, type: 'offer' }),
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
        sendSignal('sdp-answer', {
          sdp: answer.sdp,
          sessionId: nextSessionId,
        });
        canSendLocalIceCandidates = true;
        for (const candidate of pendingLocalIceCandidates) {
          sendSignal('ice-candidate', {
            candidate,
            sessionId: nextSessionId,
          });
        }
        pendingLocalIceCandidates.length = 0;
        void collectStats();
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : 'WebRTC setup failed';
        setStreamError(message);
        emitEvent({ message, type: 'error' });
        cleanupPeer(true);
      }
    },
    [
      cleanupPeer,
      collectStats,
      currentSessionId,
      emitEvent,
      iceTransportPolicy,
      normalizedHttpBaseUrl,
    ],
  );

  const handleRemoteIceCandidate = useCallback(
    async ({ candidate, sessionId }: HandleRemoteIceCandidateOptions) => {
      const normalizedSessionId = normalizeOptionalString(sessionId);
      const peerConnection = pcRef.current;

      if (
        normalizedSessionId !== null &&
        currentSessionId !== null &&
        normalizedSessionId !== currentSessionId
      ) {
        return;
      }

      if (peerConnection?.remoteDescription != null) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        return;
      }

      iceCandidateBuffer.current.push({
        candidate,
        sessionId: normalizedSessionId,
      });
    },
    [currentSessionId],
  );

  useEffect(() => {
    if (normalizedHttpBaseUrl === '') {
      cleanupPeer(true);
      setStreamError(null);
      return undefined;
    }

    return () => {
      cleanupPeer(true);
      setStreamError(null);
    };
  }, [cleanupPeer, normalizedHttpBaseUrl]);

  useEffect(() => {
    if (peerState === 'idle' && pcRef.current === null) {
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
  }, [collectStats, peerState]);

  const subscribeToEvents = useCallback((handler: WebRtcEventHandler) => {
    eventHandlersRef.current.add(handler);
    return () => {
      eventHandlersRef.current.delete(handler);
    };
  }, []);

  const closePeer = useCallback(
    (options?: { clearSession?: boolean }) => {
      cleanupPeer(options?.clearSession ?? true);
      setStreamError(null);
    },
    [cleanupPeer],
  );

  const value = useMemo<WebRtcContextValue>(
    () => ({
      closePeer,
      currentSessionId,
      handleRemoteIceCandidate,
      handleSdpOffer,
      peerState,
      stream,
      streamError,
      streamStats,
      subscribeToEvents,
    }),
    [
      closePeer,
      currentSessionId,
      handleRemoteIceCandidate,
      handleSdpOffer,
      peerState,
      stream,
      streamError,
      streamStats,
      subscribeToEvents,
    ],
  );

  return <WebRtcContext.Provider value={value}>{children}</WebRtcContext.Provider>;
};

export const useWebRtcContext = (): WebRtcContextValue => {
  const context = useContext(WebRtcContext);
  if (context === null) {
    throw new Error('useWebRtcContext must be used within a WebRtcProvider.');
  }

  return context;
};
