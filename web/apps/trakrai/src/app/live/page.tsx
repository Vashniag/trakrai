'use client';

import { useState } from 'react';

import { DeviceRuntimeProvider } from '@trakrai/live-transport/providers/device-runtime-provider';
import { CloudTransportProvider } from '@trakrai/live-transport/providers/live-transport-provider';
import { WebRtcProvider } from '@trakrai/live-transport/providers/webrtc-provider';
import { LiveConsoleShell } from '@trakrai/live-ui/components/live-console-shell';
import { LiveWorkspace } from '@trakrai/live-ui/components/live-workspace';

const DEFAULT_LIVE_DEVICE_ID = 'hacklab@10.8.0.50';

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

const LivePage = () => {
  const [deviceId, setDeviceId] = useState(DEFAULT_LIVE_DEVICE_ID);

  return (
    <LiveConsoleShell
      bridgeDescription="Routes signaling through the cloud-connected bridge while keeping the live and PTZ workspace identical to the device-hosted edge client."
      bridgeLabel="Cloud bridge"
      bridgeStatus="Shared workspace"
      contractNotes={[
        'The live feed, PTZ controls, diagnostics, and camera inventory all come from the same shared package.',
        'Cloud and edge only swap the active bridge target and the runtime metadata shown above the workspace.',
        'The browser still uses the same WebRTC negotiation path, including the shared ICE-configuration fetch contract.',
      ]}
      description="Shared live and PTZ console for cloud-connected devices, with WebRTC diagnostics and the same transport abstraction used by the edge app."
      detailItems={[
        { label: 'Device default', value: DEFAULT_LIVE_DEVICE_ID },
        { label: 'HTTP endpoint', value: liveGatewayHttpUrl },
        { label: 'WebSocket', value: liveGatewayWsUrl },
        { label: 'ICE config', value: `${liveGatewayHttpUrl}/api/ice-config` },
      ]}
      eyebrow="TrakrAI Cloud Operations"
      title="Live feed and PTZ"
    >
      <CloudTransportProvider
        deviceId={deviceId}
        httpBaseUrl={liveGatewayHttpUrl}
        signalingUrl={liveGatewayWsUrl}
      >
        <DeviceRuntimeProvider>
          <WebRtcProvider httpBaseUrl={liveGatewayHttpUrl} iceTransportPolicy="relay">
            <LiveWorkspace
              defaultDeviceId={DEFAULT_LIVE_DEVICE_ID}
              deviceId={deviceId}
              deviceIdEditable
              diagnosticsEnabled
              onDeviceIdChange={setDeviceId}
            />
          </WebRtcProvider>
        </DeviceRuntimeProvider>
      </CloudTransportProvider>
    </LiveConsoleShell>
  );
};

export default LivePage;
