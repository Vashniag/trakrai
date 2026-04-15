'use client';

export type WebRtcClientConfig = Readonly<{
  iceTransportPolicy: RTCIceTransportPolicy;
}>;

export const DEFAULT_WEBRTC_CLIENT_CONFIG: WebRtcClientConfig = {
  iceTransportPolicy: 'all',
};
