'use client';

import { createContext, useContext, type ReactNode } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { CloudTransportProvider } from '@trakrai/live-transport/providers/live-transport-provider';
import { ChevronLeft } from 'lucide-react';

import { cloudAppBuildConfig } from '@/lib/build-config';
import { useTRPCQuery } from '@/server/react';

import type { RouterOutput } from '@trakrai/backend/server/routers';

type ManagedDevice = RouterOutput['devices']['getById'];

const DeviceRouteContext = createContext<ManagedDevice | null>(null);

const ACTIVE_CLASSES = 'border-primary/40 bg-primary/10 text-primary';
const IDLE_CLASSES = 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50';

const DEVICE_ROUTE_ITEMS = (
  deviceRecordId: string,
): ReadonlyArray<{
  description: string;
  href: string;
  label: string;
}> =>
  [
    {
      description: 'Identity, access, and cloud registration details.',
      href: `/devices/${deviceRecordId}`,
      label: 'Overview',
    },
    {
      description: 'WebRTC live monitoring and PTZ controls.',
      href: `/devices/${deviceRecordId}/live`,
      label: 'Live',
    },
    {
      description: 'Runtime services and managed binary actions.',
      href: `/devices/${deviceRecordId}/runtime`,
      label: 'Runtime',
    },
    {
      description: 'Queued cloud uploads and downloads.',
      href: `/devices/${deviceRecordId}/transfers`,
      label: 'Transfers',
    },
    {
      description: 'Audio queue control, playback inspection, and speaker delivery status.',
      href: `/devices/${deviceRecordId}/audio`,
      label: 'Audio',
    },
  ] as const;

type DeviceRouteShellProps = Readonly<{
  children: ReactNode;
  deviceRecordId: string;
}>;

export const useCurrentCloudDevice = (): ManagedDevice => {
  const device = useContext(DeviceRouteContext);
  if (device === null) {
    throw new Error('useCurrentCloudDevice must be used within DeviceRouteShell.');
  }

  return device;
};

export const DeviceRouteShell = ({ children, deviceRecordId }: DeviceRouteShellProps) => {
  const pathname = usePathname();
  const deviceQuery = useTRPCQuery((api) => ({
    ...api.devices.getById.queryOptions({ id: deviceRecordId }),
    retry: false,
  }));

  if (deviceQuery.isLoading) {
    return (
      <main className="bg-background min-h-screen px-6 py-8 md:px-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <div className="text-muted-foreground">Loading device...</div>
        </div>
      </main>
    );
  }

  if (deviceQuery.error !== null || deviceQuery.data === undefined) {
    return (
      <main className="bg-background min-h-screen px-6 py-8 md:px-10">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          <Button asChild className="w-fit" variant="outline">
            <Link href="/devices">
              <ChevronLeft />
              Back to devices
            </Link>
          </Button>
          <Card className="border">
            <CardHeader className="border-b">
              <CardTitle>Device unavailable</CardTitle>
              <CardDescription>The requested device route could not be resolved.</CardDescription>
            </CardHeader>
            <CardContent className="py-6 text-sm">
              {deviceQuery.error instanceof Error ? deviceQuery.error.message : 'Device not found.'}
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const device = deviceQuery.data;

  return (
    <CloudTransportProvider
      deviceId={device.deviceId}
      httpBaseUrl={cloudAppBuildConfig.liveGatewayHttpUrl}
      signalingUrl={cloudAppBuildConfig.liveGatewayWsUrl}
    >
      <DeviceRouteContext.Provider value={device}>
        <main className="bg-background min-h-screen px-6 py-8 md:px-10">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
            <section className="space-y-3">
              <Button asChild className="w-fit" variant="outline">
                <Link href="/devices">
                  <ChevronLeft />
                  Back to devices
                </Link>
              </Button>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-muted-foreground text-xs font-medium tracking-[0.24em] uppercase">
                    TrakrAI Device Console
                  </p>
                  <h1 className="text-foreground mt-2 text-3xl font-semibold tracking-tight">
                    {device.name}
                  </h1>
                  <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
                    {device.description?.trim() !== ''
                      ? device.description
                      : 'Cloud-managed device route with live, runtime, and transfer operations.'}
                  </p>
                </div>
                <div
                  className={`border px-3 py-2 text-[11px] tracking-[0.2em] uppercase ${
                    device.isActive
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                      : 'border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {device.isActive ? 'Active' : 'Paused'}
                </div>
              </div>
            </section>

            <section className="grid gap-3 md:grid-cols-5">
              {DEVICE_ROUTE_ITEMS(deviceRecordId).map((item) => {
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

            {children}
          </div>
        </main>
      </DeviceRouteContext.Provider>
    </CloudTransportProvider>
  );
};
