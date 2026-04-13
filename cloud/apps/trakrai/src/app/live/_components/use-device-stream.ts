'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { LiveFeederClient } from '@/lib/live-feeder-client';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'streaming';

type DeviceStatus = {
  uptime: number;
  cameras: { enabled: boolean; name: string; pipeline?: string }[];
};

type UseDeviceStreamReturn = {
  connectionState: ConnectionState;
  deviceStatus: DeviceStatus | null;
  error: string | null;
  heartbeatAgeSeconds: number | null;
  startLive: (cameraName: string) => void;
  stopLive: () => void;
  stream: MediaStream | null;
};

type IceConfigResponse = {
  iceServers: RTCIceServer[];
};

type LiveFeederEnvelope<TPayload> = {
  payload?: TPayload;
  type?: string;
};

const LIVE_FEEDER_WS_URL =
  process.env['NEXT_PUBLIC_LIVE_FEEDER_WS_URL'] ??
  process.env['NEXT_PUBLIC_MEDIATOR_WS_URL'] ??
  'ws://localhost:4000/ws';
const LIVE_FEEDER_HTTP_URL =
  process.env['NEXT_PUBLIC_LIVE_FEEDER_HTTP_URL'] ??
  process.env['NEXT_PUBLIC_MEDIATOR_HTTP_URL'] ??
  'http://localhost:4000';
const HEARTBEAT_INTERVAL_MS = 1000;
const MS_PER_SECOND = 1000;

const unwrapPayload = <TPayload>(envelope: unknown): TPayload => {
  if (
    typeof envelope === 'object' &&
    envelope !== null &&
    'payload' in envelope &&
    (envelope as LiveFeederEnvelope<TPayload>).payload !== undefined
  ) {
    return (envelope as LiveFeederEnvelope<TPayload>).payload as TPayload;
  }

  return envelope as TPayload;
};

export const useDeviceStream = (deviceId: string): UseDeviceStreamReturn => {
  const normalizedDeviceId = deviceId.trim();
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [heartbeatAt, setHeartbeatAt] = useState<number | null>(null);
  const [heartbeatNow, setHeartbeatNow] = useState<number>(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const liveFeederRef = useRef<LiveFeederClient | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceCandidateBuffer = useRef<RTCIceCandidateInit[]>([]);

  const cleanupPc = useCallback(() => {
    if (pcRef.current !== null) {
      pcRef.current.close();
      pcRef.current = null;
    }

    iceCandidateBuffer.current = [];
    setStream(null);
  }, []);

  const handleSdpOffer = useCallback(
    async (payload: { sdp: string }) => {
      try {
        const iceResponse = await fetch(`${LIVE_FEEDER_HTTP_URL}/api/ice-config`);
        const iceConfig = (await iceResponse.json()) as IceConfigResponse;
        const peerConnection = new RTCPeerConnection(iceConfig);

        pcRef.current = peerConnection;

        peerConnection.ontrack = (event) => {
          setConnectionState('streaming');
          setStream(event.streams[0] ?? new MediaStream([event.track]));
        };

        peerConnection.onicecandidate = (event) => {
          if (event.candidate !== null) {
            liveFeederRef.current?.send('ice-candidate', {
              candidate: event.candidate.toJSON(),
            });
          }
        };

        peerConnection.onconnectionstatechange = () => {
          if (
            peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'failed'
          ) {
            setConnectionState('connected');
            setError('WebRTC connection lost');
            cleanupPc();
          }
        };

        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({ sdp: payload.sdp, type: 'offer' }),
        );

        for (const candidate of iceCandidateBuffer.current) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
        iceCandidateBuffer.current = [];

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        liveFeederRef.current?.send('sdp-answer', { sdp: answer.sdp });
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'WebRTC setup failed');
        cleanupPc();
      }
    },
    [cleanupPc],
  );

  const handleIceCandidate = useCallback(async (payload: { candidate: RTCIceCandidateInit }) => {
    const peerConnection = pcRef.current;
    if (peerConnection?.remoteDescription != null) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
      return;
    }

    iceCandidateBuffer.current.push(payload.candidate);
  }, []);

  useEffect(() => {
    if (normalizedDeviceId === '') {
      return undefined;
    }

    const liveFeeder = new LiveFeederClient(
      `${LIVE_FEEDER_WS_URL}?deviceId=${encodeURIComponent(normalizedDeviceId)}`,
    );
    liveFeederRef.current = liveFeeder;

    const unsubscribe = liveFeeder.onMessage((message) => {
      switch (message.type) {
        case 'session-info':
          setConnectionState('connected');
          break;
        case 'device-status':
          setConnectionState((currentState) =>
            currentState === 'streaming' ? currentState : 'connected',
          );
          setDeviceStatus(unwrapPayload<DeviceStatus>(message.payload));
          setHeartbeatAt(Date.now());
          break;
        case 'device-response': {
          const payload = unwrapPayload<{ error?: string }>(message.payload);
          const responseType =
            typeof message.payload === 'object' &&
            message.payload !== null &&
            'type' in message.payload &&
            typeof (message.payload as LiveFeederEnvelope<unknown>).type === 'string'
              ? (message.payload as LiveFeederEnvelope<unknown>).type
              : undefined;

          if (responseType === 'start-live-ack' && payload.error !== undefined) {
            setError(payload.error);
          }
          break;
        }
        case 'sdp-offer':
          void handleSdpOffer(unwrapPayload<{ sdp: string }>(message.payload));
          break;
        case 'ice-candidate':
          void handleIceCandidate(
            unwrapPayload<{ candidate: RTCIceCandidateInit }>(message.payload),
          );
          break;
        default:
          break;
      }
    });

    liveFeeder.connect();

    return () => {
      unsubscribe();
      liveFeeder.disconnect();
      cleanupPc();
    };
  }, [cleanupPc, handleIceCandidate, handleSdpOffer, normalizedDeviceId]);

  useEffect(() => {
    if (heartbeatAt === null) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setHeartbeatNow(Date.now());
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [heartbeatAt]);

  const startLive = useCallback((cameraName: string) => {
    setError(null);
    liveFeederRef.current?.send('start-live', { cameraName });
  }, []);

  const stopLive = useCallback(() => {
    liveFeederRef.current?.send('stop-live', {});
    cleanupPc();
    setConnectionState('connected');
  }, [cleanupPc]);

  const heartbeatAgeSeconds =
    heartbeatAt === null
      ? null
      : Math.max(0, Math.floor((heartbeatNow - heartbeatAt) / MS_PER_SECOND));
  let resolvedConnectionState: ConnectionState = connectionState;
  if (normalizedDeviceId === '') {
    resolvedConnectionState = 'disconnected';
  } else if (connectionState === 'disconnected') {
    resolvedConnectionState = 'connecting';
  }

  return {
    connectionState: resolvedConnectionState,
    deviceStatus: normalizedDeviceId === '' ? null : deviceStatus,
    error: normalizedDeviceId === '' ? null : error,
    heartbeatAgeSeconds,
    startLive,
    stopLive,
    stream,
  };
};
