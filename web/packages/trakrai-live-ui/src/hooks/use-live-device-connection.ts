'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ActivityLogEntry,
  ConnectionState,
  DeviceStatus,
  LiveLayoutSelection,
  PtzCapabilities,
  PtzPosition,
  PtzState,
  PtzVelocityCommand,
  StreamStats,
} from '../lib/live-types';

import { LiveTransportClient } from '../lib/live-client';
import {
  BITS_PER_BYTE,
  DISCONNECT_GRACE_MS,
  HEARTBEAT_INTERVAL_MS,
  LOG_LIMIT,
  MS_PER_SECOND,
  STALE_HEARTBEAT_SECONDS,
  STATS_INTERVAL_MS,
  createLogEntry,
  getEnvelopeType,
  getReportedLiveFeedCamera,
  normalizeEndpointUrl,
  normalizeOptionalString,
  readPtzState,
  readStatBoolean,
  readStatNumber,
  readStatString,
  unwrapPayload,
  type BufferedIceCandidate,
  type IceConfigResponse,
  type StatsSnapshot,
} from '../lib/live-transport-utils';

export type {
  ActivityLogEntry,
  ConnectionState,
  DeviceCamera,
  DeviceServiceStatus,
  DeviceStatus,
  PtzCapabilities,
  PtzMoveStatus,
  PtzPosition,
  PtzState,
  PtzVelocityCommand,
  StreamStats,
} from '../lib/live-types';

export type LiveTransportConfig = {
  deviceId: string;
  httpBaseUrl: string;
  signalingUrl: string;
};

export type LiveDeviceConnectionState = {
  activeCameraName: string | null;
  connectionState: ConnectionState;
  deviceStatus: DeviceStatus | null;
  error: string | null;
  heartbeatAgeSeconds: number | null;
  isBusy: boolean;
  logs: ActivityLogEntry[];
  goHome: (cameraName: string) => void;
  ptzError: string | null;
  ptzState: PtzState | null;
  refreshPtzPosition: (cameraName: string) => void;
  refreshStatus: () => void;
  setPtzZoom: (cameraName: string, zoom: number) => void;
  startLive: (selection: LiveLayoutSelection) => void;
  startPtzMove: (cameraName: string, velocity: PtzVelocityCommand) => void;
  stopLive: () => void;
  stopPtzMove: (cameraName: string) => void;
  stream: MediaStream | null;
  streamStats: StreamStats | null;
  updateLiveLayout: (selection: LiveLayoutSelection) => void;
  transport: {
    httpBaseUrl: string;
    signalingUrl: string;
  };
};

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
    mode: selection.mode,
  };
};

const REQUEST_ID_RADIX = 36;
let fallbackRequestCounter = 0;

const createClientRequestId = (): string => {
  const randomUuid = globalThis.crypto.randomUUID;
  if (typeof randomUuid === 'function') {
    return randomUuid.call(globalThis.crypto);
  }

  fallbackRequestCounter += 1;
  return `trakrai-${Date.now().toString(REQUEST_ID_RADIX)}-${fallbackRequestCounter.toString(
    REQUEST_ID_RADIX,
  )}`;
};

export const useLiveDeviceConnection = ({
  deviceId,
  httpBaseUrl,
  signalingUrl,
}: LiveTransportConfig): LiveDeviceConnectionState => {
  const normalizedDeviceId = deviceId.trim();
  const normalizedHttpBaseUrl = normalizeEndpointUrl(httpBaseUrl);
  const normalizedSignalingUrl = normalizeEndpointUrl(signalingUrl);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [heartbeatAt, setHeartbeatAt] = useState<number | null>(null);
  const [heartbeatNow, setHeartbeatNow] = useState<number>(Date.now());
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [activeCameraName, setActiveCameraName] = useState<string | null>(null);
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ptzError, setPtzError] = useState<string | null>(null);
  const [ptzState, setPtzState] = useState<PtzState | null>(null);

  const liveGatewayRef = useRef<LiveTransportClient | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceCandidateBuffer = useRef<BufferedIceCandidate[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const pendingSessionIdRef = useRef<string | null>(null);
  const requestedCameraRef = useRef<string | null>(null);
  const lastStatsSnapshotRef = useRef<StatsSnapshot | null>(null);
  const staleHeartbeatReportedRef = useRef(false);
  const disconnectTimerRef = useRef<number | null>(null);

  const appendLog = useCallback((level: ActivityLogEntry['level'], message: string) => {
    setLogs((currentLogs) => [createLogEntry(level, message), ...currentLogs].slice(0, LOG_LIMIT));
  }, []);

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
      activeSessionIdRef.current = null;
      activeRequestIdRef.current = null;
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

  const handleSdpOffer = useCallback(
    async (payload: {
      cameraName?: string;
      requestId?: string;
      sdp: string;
      sessionId?: string;
    }) => {
      try {
        const offeredRequestId =
          typeof (payload as { requestId?: string }).requestId === 'string'
            ? normalizeOptionalString((payload as { requestId?: string }).requestId)
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
        const expectedSessionId = pendingSessionIdRef.current ?? activeSessionIdRef.current;
        if (offeredSessionId !== null) {
          if (
            activeSessionIdRef.current !== null &&
            offeredSessionId === activeSessionIdRef.current &&
            pcRef.current !== null
          ) {
            appendLog('info', `Ignoring duplicate SDP offer for session ${offeredSessionId}`);
            return;
          }

          if (expectedSessionId !== null && offeredSessionId !== expectedSessionId) {
            appendLog('warn', `Ignoring stale SDP offer for session ${offeredSessionId}`);
            return;
          }
        }

        const nextSessionId =
          offeredSessionId ?? pendingSessionIdRef.current ?? createClientRequestId();
        const cameraName = normalizeOptionalString(payload.cameraName);

        cleanupPc(false);
        activeSessionIdRef.current = nextSessionId;
        pendingSessionIdRef.current = nextSessionId;
        setError(null);
        setConnectionState('starting');
        setActiveCameraName(cameraName ?? requestedCameraRef.current);
        appendLog('info', `Received SDP offer${cameraName !== null ? ` for ${cameraName}` : ''}`);

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
          appendLog('info', 'Remote media track attached');
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
              appendLog('info', 'Peer connection established');
              break;
            case 'disconnected':
              if (disconnectTimerRef.current !== null) {
                window.clearTimeout(disconnectTimerRef.current);
              }
              setError('Media connection interrupted. Waiting to recover...');
              appendLog('warn', 'Peer connection temporarily disconnected');
              disconnectTimerRef.current = window.setTimeout(() => {
                if (pcRef.current !== peerConnection) {
                  return;
                }
                if (peerConnection.connectionState !== 'disconnected') {
                  return;
                }
                setConnectionState('connected');
                setError('WebRTC connection lost');
                appendLog('warn', 'Peer connection did not recover in time');
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
              appendLog('warn', `Peer connection ${peerConnection.connectionState}`);
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
        const message = caughtError instanceof Error ? caughtError.message : 'WebRTC setup failed';
        setError(message);
        appendLog('error', message);
        cleanupPc(true);
      }
    },
    [appendLog, cleanupPc, collectStats, normalizedHttpBaseUrl],
  );

  const handleIceCandidate = useCallback(
    async (payload: { candidate: RTCIceCandidateInit; sessionId?: string }) => {
      const candidateRequestId =
        typeof (payload as { requestId?: string }).requestId === 'string'
          ? normalizeOptionalString((payload as { requestId?: string }).requestId)
          : null;
      if (
        candidateRequestId !== null &&
        activeRequestIdRef.current !== null &&
        candidateRequestId !== activeRequestIdRef.current
      ) {
        return;
      }

      const sessionId = normalizeOptionalString(payload.sessionId);
      const peerConnection = pcRef.current;

      if (
        sessionId !== null &&
        activeSessionIdRef.current !== null &&
        sessionId !== activeSessionIdRef.current
      ) {
        return;
      }

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
      setDeviceStatus(null);
      setHeartbeatAt(null);
      setError(null);
      setPtzError(null);
      setPtzState(null);
      return undefined;
    }

    const gatewayUrl = `${normalizedSignalingUrl}?deviceId=${encodeURIComponent(normalizedDeviceId)}`;
    const liveGateway = new LiveTransportClient(gatewayUrl);
    liveGatewayRef.current = liveGateway;

    appendLog('info', `Connecting to device ${normalizedDeviceId}`);

    const unsubscribeMessages = liveGateway.onMessage((message) => {
      switch (message.type) {
        case 'session-info':
          setConnectionState((currentState) =>
            currentState === 'streaming' ? currentState : 'connected',
          );
          appendLog('info', 'Gateway session ready');
          break;
        case 'device-status':
          setConnectionState((currentState) =>
            currentState === 'streaming' || currentState === 'starting'
              ? currentState
              : 'connected',
          );
          {
            const nextStatus = unwrapPayload<DeviceStatus>(message.payload);
            setDeviceStatus(nextStatus);
            const nextPtzState = readPtzState(nextStatus.services?.['ptz-control']);
            if (nextPtzState !== null) {
              setPtzState(nextPtzState);
              setPtzError(nextPtzState.lastError);
            }
            const reportedCamera = getReportedLiveFeedCamera(nextStatus);
            if (reportedCamera !== null) {
              setActiveCameraName(reportedCamera);
            }
          }
          setHeartbeatAt(Date.now());
          setError(null);
          staleHeartbeatReportedRef.current = false;
          break;
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
            setConnectionState((currentState) =>
              currentState === 'streaming' || currentState === 'starting'
                ? currentState
                : 'connected',
            );
            {
              const nextStatus = unwrapPayload<DeviceStatus>(message.payload);
              setDeviceStatus(nextStatus);
              const nextPtzState = readPtzState(nextStatus.services?.['ptz-control']);
              if (nextPtzState !== null) {
                setPtzState(nextPtzState);
                setPtzError(nextPtzState.lastError);
              }
              const reportedCamera = getReportedLiveFeedCamera(nextStatus);
              if (reportedCamera !== null) {
                setActiveCameraName(reportedCamera);
              }
            }
            setHeartbeatAt(Date.now());
            setError(null);
            staleHeartbeatReportedRef.current = false;
            appendLog('info', 'Device status snapshot refreshed');
            return;
          }

          if (responseType === 'start-live-ack') {
            const acknowledgedRequestId =
              typeof (payload as { requestId?: string }).requestId === 'string'
                ? normalizeOptionalString((payload as { requestId?: string }).requestId)
                : null;
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
              appendLog('error', payload.error ?? 'Device rejected the live start request');
              cleanupPc(true);
              return;
            }

            const acknowledgedCameraName = normalizeOptionalString(payload.cameraName);
            pendingSessionIdRef.current = normalizeOptionalString(payload.sessionId);
            if (acknowledgedRequestId !== null) {
              activeRequestIdRef.current = acknowledgedRequestId;
            }
            setActiveCameraName(acknowledgedCameraName ?? requestedCameraRef.current);
            setConnectionState('starting');
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
              cameraNames?: string[];
              layoutMode?: string;
              sessionId?: string;
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
            setError(payload.error);
            appendLog('error', payload.error);
          }
          break;
        }
        case 'ptz-status': {
          const payload = unwrapPayload<Omit<PtzState, 'status'>>(message.payload);
          setPtzState((currentState) => ({
            activeCamera: payload.activeCamera ?? currentState?.activeCamera ?? null,
            capabilities: payload.capabilities ?? currentState?.capabilities ?? null,
            configuredCameras:
              payload.configuredCameras.length > 0
                ? payload.configuredCameras
                : (currentState?.configuredCameras ?? []),
            lastCommand: payload.lastCommand ?? currentState?.lastCommand ?? null,
            lastError: payload.lastError ?? null,
            position: payload.position ?? currentState?.position ?? null,
            status: currentState?.status ?? 'idle',
          }));
          setPtzError(payload.lastError ?? null);
          appendLog('info', 'PTZ status snapshot refreshed');
          break;
        }
        case 'ptz-response': {
          const responseType = getEnvelopeType(message.payload);
          if (responseType === null) {
            break;
          }

          if (responseType === 'ptz-position') {
            const payload = unwrapPayload<PtzPosition>(message.payload);
            setPtzState((currentState) => ({
              activeCamera: payload.cameraName,
              capabilities: payload.capabilities ?? currentState?.capabilities ?? null,
              configuredCameras: currentState?.configuredCameras ?? [],
              lastCommand: 'get-position',
              lastError: null,
              position: payload,
              status: currentState?.status ?? 'idle',
            }));
            setPtzError(null);
            appendLog('info', `PTZ position refreshed for ${payload.cameraName}`);
            break;
          }

          if (responseType === 'ptz-command-ack') {
            const payload = unwrapPayload<{
              capabilities?: PtzCapabilities | null;
              cameraName: string;
              command: string;
              ok?: boolean;
              position?: PtzPosition;
            }>(message.payload);
            setPtzState((currentState) => ({
              activeCamera:
                normalizeOptionalString(payload.cameraName) ?? currentState?.activeCamera ?? null,
              capabilities:
                payload.capabilities ??
                payload.position?.capabilities ??
                currentState?.capabilities ??
                null,
              configuredCameras: currentState?.configuredCameras ?? [],
              lastCommand:
                normalizeOptionalString(payload.command) ?? currentState?.lastCommand ?? null,
              lastError: null,
              position: payload.position ?? currentState?.position ?? null,
              status: payload.command === 'start-move' ? 'moving' : 'idle',
            }));
            setPtzError(null);
            appendLog(
              'info',
              `PTZ command acknowledged: ${payload.command}${
                typeof payload.cameraName === 'string' && payload.cameraName.trim() !== ''
                  ? ` (${payload.cameraName})`
                  : ''
              }`,
            );
            break;
          }

          if (responseType === 'ptz-error' || responseType === 'service-unavailable') {
            const payload = unwrapPayload<{
              cameraName?: string;
              command?: string;
              error?: string;
              requestType?: string;
            }>(message.payload);
            const nextError =
              payload.error ?? `PTZ ${payload.command ?? payload.requestType ?? 'request'} failed`;
            setPtzError(nextError);
            setPtzState((currentState) => ({
              activeCamera:
                normalizeOptionalString(payload.cameraName) ?? currentState?.activeCamera ?? null,
              capabilities: currentState?.capabilities ?? null,
              configuredCameras: currentState?.configuredCameras ?? [],
              lastCommand:
                normalizeOptionalString(payload.command ?? payload.requestType) ??
                currentState?.lastCommand ??
                null,
              lastError: nextError,
              position: currentState?.position ?? null,
              status: 'error',
            }));
            appendLog('error', nextError);
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
          appendLog('info', `Opening gateway socket (attempt ${event.attempt})`);
          break;
        case 'open':
          setConnectionState((currentState) =>
            currentState === 'streaming' ? currentState : 'connected',
          );
          setError(null);
          liveGateway.requestStatus();
          appendLog('info', 'Gateway socket connected');
          break;
        case 'closed':
          setConnectionState((currentState) =>
            currentState === 'disconnected' ? currentState : 'reconnecting',
          );
          appendLog(
            'warn',
            `Gateway socket closed${event.reason !== undefined ? ` (${event.reason})` : ''}`,
          );
          break;
        case 'reconnect-scheduled':
          setConnectionState((currentState) =>
            currentState === 'disconnected' ? currentState : 'reconnecting',
          );
          appendLog('warn', `Retrying gateway connection in ${event.delayMs}ms`);
          break;
        case 'error':
          setError(event.message ?? 'Gateway transport error');
          appendLog('error', event.message ?? 'Gateway transport error');
          break;
        default:
          break;
      }
    });

    liveGateway.connect();

    return () => {
      unsubscribeMessages();
      unsubscribeStatus();
      liveGateway.disconnect();
      liveGatewayRef.current = null;
      cleanupPc(true);
      setHeartbeatAt(null);
      setStreamStats(null);
      setPtzError(null);
      setPtzState(null);
    };
  }, [
    appendLog,
    cleanupPc,
    handleIceCandidate,
    handleSdpOffer,
    normalizedDeviceId,
    normalizedHttpBaseUrl,
    normalizedSignalingUrl,
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
    if (normalizedDeviceId === '') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setHeartbeatNow(Date.now());
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [normalizedDeviceId]);

  const startLive = useCallback(
    (selection: LiveLayoutSelection) => {
      const normalizedSelection = normalizeLiveLayoutSelection(selection);
      const primaryCameraName = normalizedSelection.cameraNames[0] ?? null;
      if (primaryCameraName === null) {
        return;
      }

      const previousSessionId = activeSessionIdRef.current ?? pendingSessionIdRef.current;
      if (previousSessionId !== null) {
        liveGatewayRef.current?.send('stop-live', { sessionId: previousSessionId });
        cleanupPc(true);
      }

      requestedCameraRef.current = primaryCameraName;
      activeRequestIdRef.current = createClientRequestId();
      pendingSessionIdRef.current = null;
      setError(null);
      setConnectionState('starting');
      setActiveCameraName(primaryCameraName);
      appendLog(
        'info',
        `Requesting ${normalizedSelection.mode} live view with ${normalizedSelection.cameraNames.length} camera${
          normalizedSelection.cameraNames.length === 1 ? '' : 's'
        }`,
      );
      liveGatewayRef.current?.send('start-live', {
        cameraName: primaryCameraName,
        cameraNames: normalizedSelection.cameraNames,
        layoutMode: normalizedSelection.mode,
        requestId: activeRequestIdRef.current,
      });
    },
    [appendLog, cleanupPc],
  );

  const updateLiveLayout = useCallback(
    (selection: LiveLayoutSelection) => {
      const normalizedSelection = normalizeLiveLayoutSelection(selection);
      const primaryCameraName = normalizedSelection.cameraNames[0] ?? null;
      if (primaryCameraName === null) {
        return;
      }

      const sessionId = activeSessionIdRef.current ?? pendingSessionIdRef.current;
      if (sessionId === null) {
        startLive(normalizedSelection);
        return;
      }

      requestedCameraRef.current = primaryCameraName;
      setActiveCameraName(primaryCameraName);
      setError(null);
      appendLog(
        'info',
        `Updating live layout to ${normalizedSelection.mode} (${normalizedSelection.cameraNames.length} cameras)`,
      );
      liveGatewayRef.current?.send('update-live-layout', {
        cameraName: primaryCameraName,
        cameraNames: normalizedSelection.cameraNames,
        layoutMode: normalizedSelection.mode,
        sessionId,
      });
    },
    [appendLog, startLive],
  );

  const stopLive = useCallback(() => {
    appendLog('info', 'Stopping live feed');
    liveGatewayRef.current?.send('stop-live', {
      sessionId: activeSessionIdRef.current ?? pendingSessionIdRef.current ?? undefined,
    });
    requestedCameraRef.current = null;
    cleanupPc(true);
    setConnectionState('connected');
    liveGatewayRef.current?.requestStatus();
  }, [appendLog, cleanupPc]);

  const refreshStatus = useCallback(() => {
    appendLog('info', 'Requesting latest device status');
    liveGatewayRef.current?.requestStatus();
  }, [appendLog]);

  const refreshPtzPosition = useCallback(
    (cameraName: string) => {
      const normalizedCameraName = cameraName.trim();
      if (normalizedCameraName === '') {
        return;
      }

      appendLog('info', `Requesting PTZ position for ${normalizedCameraName}`);
      setPtzError(null);
      liveGatewayRef.current?.send('ptz-get-position', { cameraName: normalizedCameraName });
    },
    [appendLog],
  );

  const startPtzMove = useCallback((cameraName: string, velocity: PtzVelocityCommand) => {
    const normalizedCameraName = cameraName.trim();
    if (normalizedCameraName === '') {
      return;
    }

    setPtzError(null);
    setPtzState((currentState) => ({
      activeCamera: normalizedCameraName,
      capabilities: currentState?.capabilities ?? null,
      configuredCameras: currentState?.configuredCameras ?? [],
      lastCommand: 'start-move',
      lastError: null,
      position: currentState?.position ?? null,
      status: 'moving',
    }));
    liveGatewayRef.current?.send('ptz-start-move', {
      cameraName: normalizedCameraName,
      velocity,
    });
  }, []);

  const stopPtzMove = useCallback((cameraName: string) => {
    const normalizedCameraName = cameraName.trim();
    if (normalizedCameraName === '') {
      return;
    }

    liveGatewayRef.current?.send('ptz-stop', { cameraName: normalizedCameraName });
  }, []);

  const setPtzZoom = useCallback(
    (cameraName: string, zoom: number) => {
      const normalizedCameraName = cameraName.trim();
      if (normalizedCameraName === '') {
        return;
      }

      appendLog('info', `Setting PTZ zoom for ${normalizedCameraName} to ${zoom.toFixed(2)}`);
      setPtzError(null);
      liveGatewayRef.current?.send('ptz-set-zoom', {
        cameraName: normalizedCameraName,
        zoom,
      });
    },
    [appendLog],
  );

  const goHome = useCallback(
    (cameraName: string) => {
      const normalizedCameraName = cameraName.trim();
      if (normalizedCameraName === '') {
        return;
      }

      appendLog('info', `Sending PTZ home command for ${normalizedCameraName}`);
      setPtzError(null);
      liveGatewayRef.current?.send('ptz-go-home', { cameraName: normalizedCameraName });
    },
    [appendLog],
  );

  const heartbeatAgeSeconds =
    heartbeatAt === null
      ? null
      : Math.max(0, Math.floor((heartbeatNow - heartbeatAt) / MS_PER_SECOND));

  useEffect(() => {
    if (
      heartbeatAgeSeconds !== null &&
      heartbeatAgeSeconds >= STALE_HEARTBEAT_SECONDS &&
      !staleHeartbeatReportedRef.current
    ) {
      staleHeartbeatReportedRef.current = true;
      appendLog('warn', `Device heartbeat is stale (${heartbeatAgeSeconds}s)`);
    }
  }, [appendLog, heartbeatAgeSeconds]);

  let resolvedConnectionState: ConnectionState = connectionState;
  if (normalizedDeviceId === '') {
    resolvedConnectionState = 'disconnected';
  } else if (connectionState === 'disconnected') {
    resolvedConnectionState = 'connecting';
  }

  const resolvedDeviceStatus = normalizedDeviceId === '' ? null : deviceStatus;
  const resolvedError = normalizedDeviceId === '' ? null : error;
  const resolvedPtzError = normalizedDeviceId === '' ? null : ptzError;
  const resolvedPtzState = normalizedDeviceId === '' ? null : ptzState;
  const isBusy =
    resolvedConnectionState === 'connecting' ||
    resolvedConnectionState === 'starting' ||
    resolvedConnectionState === 'reconnecting';

  return {
    activeCameraName,
    connectionState: resolvedConnectionState,
    deviceStatus: resolvedDeviceStatus,
    error: resolvedError,
    goHome,
    heartbeatAgeSeconds,
    isBusy,
    logs,
    ptzError: resolvedPtzError,
    ptzState: resolvedPtzState,
    refreshPtzPosition,
    refreshStatus,
    setPtzZoom,
    startLive,
    startPtzMove,
    stopLive,
    stopPtzMove,
    stream,
    streamStats,
    updateLiveLayout,
    transport: {
      httpBaseUrl: normalizedHttpBaseUrl,
      signalingUrl: normalizedSignalingUrl,
    },
  };
};
