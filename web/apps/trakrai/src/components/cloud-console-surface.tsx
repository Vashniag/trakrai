'use client';

import { useEffect, useState, type ReactNode } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Card, CardContent, CardHeader, CardTitle } from '@trakrai/design-system/components/card';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { CloudTransportProvider } from '@trakrai/live-transport/providers/live-transport-provider';
import { LiveConsoleShell } from '@trakrai/live-ui/components/live-console-shell';

import { cloudAppBuildConfig } from '@/lib/build-config';

const STORAGE_KEY = 'trakrai-cloud-device-id';
export const DEFAULT_CLOUD_DEVICE_ID = 'hacklab@10.8.0.50';

const CLOUD_ROUTE_ITEMS = [
  {
    description: 'WebRTC live monitoring and PTZ controls.',
    href: '/live',
    label: 'Live',
  },
  {
    description: 'Runtime services and device control actions.',
    href: '/runtime',
    label: 'Runtime',
  },
  {
    description: 'Queued cloud uploads and downloads.',
    href: '/transfers',
    label: 'Transfers',
  },
] as const;

const ACTIVE_CLASSES = 'border-primary/40 bg-primary/10 text-primary';
const IDLE_CLASSES = 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50';

type CloudConsoleSurfaceProps = Readonly<{
  children: ReactNode;
  description: string;
  title: string;
}>;

const DeviceSelectionCard = ({
  deviceId,
  onDeviceIdChange,
}: Readonly<{
  deviceId: string;
  onDeviceIdChange: (nextValue: string) => void;
}>) => (
  <Card className="border">
    <CardHeader className="border-b">
      <CardTitle className="text-base">Cloud target</CardTitle>
    </CardHeader>
    <CardContent className="py-6">
      <div className="space-y-2">
        <Label htmlFor="cloud-live-device-id">Device ID</Label>
        <Input
          id="cloud-live-device-id"
          value={deviceId}
          onChange={(event) => {
            onDeviceIdChange(event.target.value);
          }}
        />
      </div>
    </CardContent>
  </Card>
);

export const CloudConsoleSurface = ({ children, description, title }: CloudConsoleSurfaceProps) => {
  const pathname = usePathname();
  const [deviceId, setDeviceId] = useState(DEFAULT_CLOUD_DEVICE_ID);

  useEffect(() => {
    const storedDeviceId = window.localStorage.getItem(STORAGE_KEY)?.trim();
    if (storedDeviceId === undefined || storedDeviceId === '') {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      setDeviceId(storedDeviceId);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    const normalizedDeviceId = deviceId.trim();
    if (normalizedDeviceId === '') {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, normalizedDeviceId);
  }, [deviceId]);

  return (
    <CloudTransportProvider
      deviceId={deviceId}
      httpBaseUrl={cloudAppBuildConfig.liveGatewayHttpUrl}
      signalingUrl={cloudAppBuildConfig.liveGatewayWsUrl}
    >
      <LiveConsoleShell
        bridgeDescription="Routes signaling through the cloud-connected gateway while keeping the UI routes narrowly focused on one feature at a time."
        bridgeLabel="Cloud gateway"
        bridgeStatus="Shared transport"
        contractNotes={[
          'The cloud app only mounts the transport layer by default; WebRTC is added on the live route only.',
          'Runtime and transfer routes call device services through the same request/response transport, without their own network clients.',
          'Device ID selection stays in the app shell, while the feature packages stay focused on PTZ, live video, runtime control, and transfers.',
        ]}
        controls={<DeviceSelectionCard deviceId={deviceId} onDeviceIdChange={setDeviceId} />}
        description={description}
        detailItems={[
          { label: 'Active device', value: deviceId },
          { label: 'HTTP endpoint', value: cloudAppBuildConfig.liveGatewayHttpUrl },
          { label: 'WebSocket', value: cloudAppBuildConfig.liveGatewayWsUrl },
          {
            label: 'ICE config',
            value: `${cloudAppBuildConfig.liveGatewayHttpUrl}/api/ice-config`,
          },
          { label: 'ICE transport', value: cloudAppBuildConfig.iceTransportPolicy },
        ]}
        eyebrow="TrakrAI Cloud Operations"
        navigation={
          <section className="grid gap-3 md:grid-cols-3">
            {CLOUD_ROUTE_ITEMS.map((item) => {
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
        {children}
      </LiveConsoleShell>
    </CloudTransportProvider>
  );
};
