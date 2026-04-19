'use client';

import { useCurrentCloudDevice, useDeviceRouteContext } from '@/components/device-route-shell';

const formatTimestamp = (value: Date): string =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);

const DeviceOverviewPage = () => {
  const device = useCurrentCloudDevice();
  const routeContext = useDeviceRouteContext();

  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <section className="border">
        <div className="border-b px-6 py-4">
          <h2 className="text-xl font-semibold">Basic details</h2>
        </div>
        <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
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
            {device.description?.trim() !== '' ? (
              <div className="text-sm">{device.description}</div>
            ) : null}
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Access token
            </div>
            <div className="text-sm font-medium break-all">
              {device.accessToken ?? 'Visible only to sysadmin.'}
            </div>
          </div>
        </div>
      </section>

      <section className="border">
        <div className="border-b px-6 py-4">
          <h2 className="text-xl font-semibold">Lifecycle</h2>
        </div>
        <div className="space-y-4 px-6 py-6">
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
        </div>
      </section>

      <section className="border xl:col-span-2">
        <div className="border-b px-6 py-4">
          <h2 className="text-xl font-semibold">Device apps</h2>
        </div>
        <div className="grid gap-4 px-6 py-6 md:grid-cols-2 xl:grid-cols-4">
          {routeContext.components.map((component) => (
            <div key={component.id} className="border p-4">
              <div className="font-medium">{component.navigationLabel}</div>
              {component.description?.trim() !== '' ? (
                <div className="text-muted-foreground mt-1 text-xs">{component.description}</div>
              ) : null}
              <div className="text-muted-foreground mt-3 text-[11px] tracking-[0.16em] uppercase">
                {component.accessLevel === 'write' ? 'Read / write' : 'Read only'}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default DeviceOverviewPage;
