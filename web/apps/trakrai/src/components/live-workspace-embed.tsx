'use client';

import { DeviceRuntimeProvider } from '@trakrai/live-transport/providers/device-runtime-provider';
import { CloudTransportProvider } from '@trakrai/live-transport/providers/live-transport-provider';
import { WebRtcProvider } from '@trakrai/live-transport/providers/webrtc-provider';
import { LiveWorkspace } from '@trakrai/live-ui/components/live-workspace';

const liveGatewayWsUrl =
  process.env['NEXT_PUBLIC_LIVE_GATEWAY_WS_URL'] ??
  process.env['NEXT_PUBLIC_LIVE_FEEDER_WS_URL'] ??
  process.env['NEXT_PUBLIC_MEDIATOR_WS_URL'] ??
  'ws://localhost:4000/ws';

const liveGatewayHttpUrl =
  process.env['NEXT_PUBLIC_LIVE_GATEWAY_HTTP_URL'] ??
  process.env['NEXT_PUBLIC_LIVE_FEEDER_HTTP_URL'] ??
  process.env['NEXT_PUBLIC_MEDIATOR_HTTP_URL'] ??
  'http://localhost:4000';

const liveGatewayIceTransportPolicy =
  process.env['NEXT_PUBLIC_LIVE_GATEWAY_ICE_TRANSPORT_POLICY'] === 'relay' ? 'relay' : 'all';

export const LiveWorkspaceEmbed = ({
  deviceId,
  deviceIdEditable = false,
}: {
  deviceId: string;
  deviceIdEditable?: boolean;
}) => (
  <CloudTransportProvider
    deviceId={deviceId}
    httpBaseUrl={liveGatewayHttpUrl}
    signalingUrl={liveGatewayWsUrl}
  >
    <DeviceRuntimeProvider>
      <WebRtcProvider
        httpBaseUrl={liveGatewayHttpUrl}
        iceTransportPolicy={liveGatewayIceTransportPolicy}
      >
        <LiveWorkspace
          defaultDeviceId={deviceId}
          deviceId={deviceId}
          deviceIdEditable={deviceIdEditable}
          diagnosticsEnabled
          onDeviceIdChange={() => {}}
        />
      </WebRtcProvider>
    </DeviceRuntimeProvider>
  </CloudTransportProvider>
);
