'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Card, CardContent } from '@trakrai/design-system/components/card';
import { EdgeTransportProvider } from '@trakrai/live-transport/providers/live-transport-provider';

import { LiveConsoleShell } from '@/components/live-console-shell';
import { DeviceQueryProvider } from '@/lib/device-query-provider';
import { deviceUiBuildConfig } from '@/lib/device-ui-build-config';
import {
  getDefaultDeviceUiRuntimeConfig,
  loadDeviceUiRuntimeConfig,
  resolveDeviceUiTransport,
  type DeviceTransportMode,
  type DeviceUiRuntimeConfig,
} from '@/lib/runtime-config';

const modeLabels: Record<DeviceTransportMode, string> = {
  cloud: 'Cloud bridge',
  edge: 'Edge bridge',
};

const EDGE_ROUTE_ITEMS = [
  {
    description: 'WebRTC live monitoring and PTZ controls.',
    href: '/',
    label: 'Live',
  },
  {
    description: 'Runtime services and managed binaries.',
    href: '/runtime',
    label: 'Runtime',
  },
  {
    description: 'Queued cloud uploads and downloads.',
    href: '/transfers',
    label: 'Transfers',
  },
  {
    description: 'Audio queue control, playback inspection, and speaker delivery status.',
    href: '/audio',
    label: 'Audio',
  },
  {
    description: 'PTZ base locations and ROI region management.',
    href: '/roi',
    label: 'ROI',
  },
] as const;

const ACTIVE_CLASSES = 'border-primary/40 bg-primary/10 text-primary';
const IDLE_CLASSES = 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50';

type EdgeConsoleSurfaceProps = Readonly<{
  children: (runtimeConfig: DeviceUiRuntimeConfig) => ReactNode;
  description: string;
  title: string;
}>;

export const EdgeConsoleSurface = ({ children, description, title }: EdgeConsoleSurfaceProps) => {
  const pathname = usePathname();
  const [runtimeConfig, setRuntimeConfig] = useState<DeviceUiRuntimeConfig>(
    getDefaultDeviceUiRuntimeConfig(deviceUiBuildConfig),
  );
  const [hasLoadedRuntimeConfig, setHasLoadedRuntimeConfig] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();

    const hydrateRuntimeConfig = async () => {
      const loadedConfig = await loadDeviceUiRuntimeConfig(
        deviceUiBuildConfig,
        abortController.signal,
      );
      if (abortController.signal.aborted) {
        return;
      }

      setRuntimeConfig(loadedConfig);
      setHasLoadedRuntimeConfig(true);
    };

    void hydrateRuntimeConfig();

    return () => {
      abortController.abort();
    };
  }, []);

  const activeTransport = useMemo(() => resolveDeviceUiTransport(runtimeConfig), [runtimeConfig]);
  const bridgeStatus = hasLoadedRuntimeConfig ? 'Runtime config loaded' : 'Using build defaults';

  return (
    <LiveConsoleShell
      bridgeDescription="The edge app reads runtime config from `cloud-comm` and only mounts the feature layers needed by the active route."
      bridgeLabel={modeLabels[runtimeConfig.transportMode]}
      bridgeStatus={bridgeStatus}
      contractNotes={[
        'The edge app keeps transport setup in the app shell, and only the live and ROI routes mount WebRTC.',
        'Runtime and transfer routes stay transport-only surfaces, while ROI adds device-local editing on top of the same request/response contract.',
        'This keeps exported edge pages smaller and easier to debug while preserving the same feature packages as the cloud app.',
      ]}
      description={description}
      detailItems={[
        { label: 'Device ID', value: runtimeConfig.deviceId },
        { label: 'Endpoint', value: activeTransport.endpoint },
        { label: 'Manager', value: runtimeConfig.managementService },
        { label: 'WebSocket', value: activeTransport.signalingUrl },
        { label: 'ICE config', value: `${activeTransport.httpBaseUrl}/api/ice-config` },
      ]}
      eyebrow="TrakrAI Edge Runtime"
      navigation={
        <section className="grid gap-3 md:grid-cols-5">
          {EDGE_ROUTE_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                className={`border px-4 py-4 text-left transition ${
                  isActive ? ACTIVE_CLASSES : IDLE_CLASSES
                }`}
                href={item.href}
              >
                <div className="font-medium">{item.label}</div>
                <div className="text-muted-foreground mt-1 text-xs">{item.description}</div>
              </Link>
            );
          })}
        </section>
      }
      title={title}
    >
      {hasLoadedRuntimeConfig ? (
        <DeviceQueryProvider>
          <EdgeTransportProvider
            deviceId={runtimeConfig.deviceId}
            httpBaseUrl={activeTransport.httpBaseUrl}
            signalingUrl={activeTransport.signalingUrl}
          >
            {children(runtimeConfig)}
          </EdgeTransportProvider>
        </DeviceQueryProvider>
      ) : (
        <Card className="border">
          <CardContent className="text-muted-foreground py-10 text-sm">
            Loading device runtime configuration...
          </CardContent>
        </Card>
      )}
    </LiveConsoleShell>
  );
};
