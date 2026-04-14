'use client';

import { useEffect, useMemo, useState } from 'react';

import { Card, CardContent } from '@trakrai/design-system/components/card';
import { DeviceRuntimeProvider } from '@trakrai/live-transport/providers/device-runtime-provider';
import { EdgeTransportProvider } from '@trakrai/live-transport/providers/live-transport-provider';
import { WebRtcProvider } from '@trakrai/live-transport/providers/webrtc-provider';
import { LiveConsoleShell } from '@trakrai/live-ui/components/live-console-shell';
import { LiveWorkspace } from '@trakrai/live-ui/components/live-workspace';

import {
  DEFAULT_DEVICE_UI_RUNTIME_CONFIG,
  readDeviceUiRuntimeConfig,
  resolveDeviceUiTransport,
  type DeviceTransportMode,
  type DeviceUiRuntimeConfig,
} from '@/lib/runtime-config';

const modeLabels: Record<DeviceTransportMode, string> = {
  cloud: 'Cloud bridge',
  edge: 'Edge bridge',
};

const modeDescriptions: Record<DeviceTransportMode, string> = {
  cloud:
    'Routes signaling through the cloud-connected bridge while keeping the shared live and PTZ UI unchanged.',
  edge: 'Uses the on-device bridge directly so the exported static app can keep working without the cloud path.',
};

export const DeviceAppShell = () => {
  const [runtimeConfig, setRuntimeConfig] = useState<DeviceUiRuntimeConfig>(
    DEFAULT_DEVICE_UI_RUNTIME_CONFIG,
  );
  const [hasLoadedRuntimeConfig, setHasLoadedRuntimeConfig] = useState(false);

  useEffect(() => {
    const frameHandle = window.requestAnimationFrame(() => {
      setRuntimeConfig(readDeviceUiRuntimeConfig());
      setHasLoadedRuntimeConfig(true);
    });

    return () => {
      window.cancelAnimationFrame(frameHandle);
    };
  }, []);

  const activeTransport = useMemo(() => resolveDeviceUiTransport(runtimeConfig), [runtimeConfig]);
  const transportKey = `${runtimeConfig.transportMode}:${runtimeConfig.deviceId}:${activeTransport.signalingUrl}:${activeTransport.httpBaseUrl}`;
  const showLiveWorkspace = hasLoadedRuntimeConfig;
  const bridgeStatus = hasLoadedRuntimeConfig ? 'Runtime config loaded' : 'Using build defaults';

  return (
    <LiveConsoleShell
      bridgeDescription={modeDescriptions[runtimeConfig.transportMode]}
      bridgeLabel={modeLabels[runtimeConfig.transportMode]}
      bridgeStatus={bridgeStatus}
      contractNotes={[
        '`public/runtime-config.js` decides whether the exported client talks to the local edge bridge or a cloud-connected bridge.',
        'Both transport modes expose the same WebSocket signaling messages and the same browser ICE-configuration endpoint.',
        'That keeps the live feed, PTZ controls, diagnostics, and future shared panels visually identical on both surfaces.',
      ]}
      description="Shared client-side console running from the exported Next.js app, backed by the same live transport abstraction as the cloud surface."
      detailItems={[
        { label: 'Device ID', value: runtimeConfig.deviceId },
        { label: 'Endpoint', value: activeTransport.endpoint },
        { label: 'WebSocket', value: activeTransport.signalingUrl },
        { label: 'ICE config', value: `${activeTransport.httpBaseUrl}/api/ice-config` },
      ]}
      eyebrow="TrakrAI Edge Runtime"
      title="Live feed and PTZ"
    >
      {showLiveWorkspace ? (
        <EdgeTransportProvider
          key={transportKey}
          deviceId={runtimeConfig.deviceId}
          httpBaseUrl={activeTransport.httpBaseUrl}
          signalingUrl={activeTransport.signalingUrl}
        >
          <DeviceRuntimeProvider>
            <WebRtcProvider httpBaseUrl={activeTransport.httpBaseUrl}>
              <LiveWorkspace
                defaultDeviceId={runtimeConfig.deviceId}
                deviceId={runtimeConfig.deviceId}
                deviceIdEditable={false}
                diagnosticsEnabled={runtimeConfig.diagnosticsEnabled}
                onDeviceIdChange={() => undefined}
              />
            </WebRtcProvider>
          </DeviceRuntimeProvider>
        </EdgeTransportProvider>
      ) : (
        <Card className="border-black/10 bg-white/90 shadow-[0_20px_70px_-45px_rgba(15,23,42,0.45)]">
          <CardContent className="py-10 text-sm text-slate-600">
            Loading device runtime configuration...
          </CardContent>
        </Card>
      )}
    </LiveConsoleShell>
  );
};
