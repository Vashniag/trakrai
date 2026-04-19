'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

import { useCurrentCloudDevice, useDeviceRouteContext } from '@/components/device-route-shell';

const formatTimestamp = (value: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);

const DeviceOverviewPage = () => {
  const device = useCurrentCloudDevice();
  const routeContext = useDeviceRouteContext();

  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-xl">Basic details</CardTitle>
          <CardDescription>
            Core identity and authentication data for this cloud-managed device.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 py-6 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Device name
            </div>
            <div className="text-sm font-medium">{device.name}</div>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Cloud device ID
            </div>
            <div className="text-sm font-medium break-all">{device.deviceId}</div>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Description
            </div>
            <div className="text-sm">
              {device.description?.trim() !== '' ? device.description : 'No description provided.'}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Access token
            </div>
            <div className="text-sm font-medium break-all">
              {device.accessToken ?? 'Visible only to sysadmin.'}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-xl">Lifecycle</CardTitle>
          <CardDescription>
            Operational status and record timestamps for this device entry.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center justify-between gap-4 border p-4">
            <span className="text-sm">Authentication state</span>
            <span
              className={`border px-2 py-1 text-[10px] tracking-[0.2em] uppercase ${
                device.isActive
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                  : 'border-border bg-muted text-muted-foreground'
              }`}
            >
              {device.isActive ? 'Active' : 'Paused'}
            </span>
          </div>
          <div className="border p-4">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Created
            </div>
            <div className="mt-2 text-sm font-medium">{formatTimestamp(device.createdAt)}</div>
          </div>
          <div className="border p-4">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Last updated
            </div>
            <div className="mt-2 text-sm font-medium">{formatTimestamp(device.updatedAt)}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="border xl:col-span-2">
        <CardHeader className="border-b">
          <CardTitle className="text-xl">Device apps</CardTitle>
          <CardDescription>
            Apps currently enabled on this device and accessible in the top sub-navigation.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 py-6 md:grid-cols-2 xl:grid-cols-4">
          {routeContext.components.map((component) => (
            <div key={component.id} className="border p-4">
              <div className="font-medium">{component.navigationLabel}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                {component.description?.trim() !== ''
                  ? component.description
                  : `${component.navigationLabel} is available on this device.`}
              </div>
              <div className="text-muted-foreground mt-3 text-[11px] tracking-[0.16em] uppercase">
                {component.accessLevel === 'write' ? 'Read / write' : 'Read only'}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default DeviceOverviewPage;
