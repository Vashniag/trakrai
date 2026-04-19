'use client';

import { createContext, useContext, type ReactNode } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { CloudTransportProvider } from '@trakrai/live-transport/providers/live-transport-provider';

import { StatCard } from '@/components/hierarchy/stat-card';
import { WorkspaceShell } from '@/components/hierarchy/workspace-shell';
import { cloudAppBuildConfig } from '@/lib/build-config';

import type { RouterOutput } from '@trakrai/backend/server/routers';

type DeviceRouteContextValue = RouterOutput['workspace']['getDeviceWorkspace'];
type ManagedDevice = DeviceRouteContextValue['device'];

const DeviceRouteContext = createContext<DeviceRouteContextValue | null>(null);

const ACTIVE_CLASSES = 'border-primary/40 bg-primary/10 text-primary';
const IDLE_CLASSES = 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50';

const buildDeviceRouteItems = (
  deviceRecordId: string,
  routeContext: DeviceRouteContextValue,
): ReadonlyArray<{
  href: string;
  label: string;
}> =>
  [
    {
      href: `/devices/${deviceRecordId}`,
      label: 'Home',
    },
    ...routeContext.components
      .filter((component) => component.routePath !== null && component.routePath.trim() !== '')
      .map((component) => ({
        href: `/devices/${deviceRecordId}/${component.routePath}`,
        label: component.navigationLabel,
      })),
  ] as const;

type DeviceRouteShellProps = Readonly<{
  children: ReactNode;
  routeContext: DeviceRouteContextValue;
}>;

export const useCurrentCloudDevice = (): ManagedDevice => {
  const routeContext = useContext(DeviceRouteContext);
  if (routeContext === null) {
    throw new Error('useCurrentCloudDevice must be used within DeviceRouteShell.');
  }

  return routeContext.device;
};

export const useDeviceRouteContext = (): DeviceRouteContextValue => {
  const routeContext = useContext(DeviceRouteContext);
  if (routeContext === null) {
    throw new Error('useDeviceRouteContext must be used within DeviceRouteShell.');
  }

  return routeContext;
};

export const DeviceRouteShell = ({ children, routeContext }: DeviceRouteShellProps) => {
  const pathname = usePathname();
  const { device } = routeContext;
  const routeItems = buildDeviceRouteItems(device.id, routeContext);
  const isHomeRoute = pathname === `/devices/${device.id}`;
  const currentRouteAllowed = isHomeRoute || routeItems.some((item) => item.href === pathname);

  return (
    <CloudTransportProvider
      deviceId={device.deviceId}
      gatewayAccessToken={routeContext.gatewayAccessToken}
      httpBaseUrl={cloudAppBuildConfig.liveGatewayHttpUrl}
      signalingUrl={cloudAppBuildConfig.liveGatewayWsUrl}
    >
      <DeviceRouteContext.Provider value={routeContext}>
        <WorkspaceShell
          breadcrumbs={[
            {
              href: `/factories/${device.factoryId}`,
              label: device.factoryName,
            },
            {
              href: `/departments/${device.departmentId}`,
              label: device.departmentName,
            },
            { label: device.name },
          ]}
          currentSidebarItemId={device.id}
          description={`Device workspace for ${device.departmentName} in ${device.factoryName}, with app-level access already resolved on the server.`}
          eyebrow="Device Workspace"
          sidebarDescription="Devices visible inside your current department scope."
          sidebarItems={routeContext.devices.map((deviceRow) => ({
            badge: `${deviceRow.enabledAppCount}/${deviceRow.totalAppCount}`,
            description: deviceRow.description,
            href: `/devices/${deviceRow.id}`,
            id: deviceRow.id,
            label: deviceRow.name,
            meta: deviceRow.isActive ? 'Active' : 'Paused',
          }))}
          sidebarTitle="Devices"
          stats={
            <>
              <StatCard title="Installed Apps" value={routeContext.stats.totalAppCount} />
              <StatCard title="Enabled Apps" value={routeContext.stats.enabledAppCount} />
              <StatCard title="Visible Apps" value={routeContext.stats.visibleAppCount} />
            </>
          }
          title={device.name}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <section className="flex shrink-0 flex-wrap gap-3">
              {routeItems.map((item) => {
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    className={`border px-4 py-2.5 text-left text-sm transition ${isActive ? ACTIVE_CLASSES : IDLE_CLASSES}`}
                    href={item.href}
                  >
                    <div className="font-medium">{item.label}</div>
                  </Link>
                );
              })}
            </section>

            {currentRouteAllowed ? (
              <div className="min-h-0 flex-1 overflow-auto">{children}</div>
            ) : (
              <section className="border px-6 py-6 text-sm">
                <h2 className="text-base font-semibold">Device app unavailable</h2>
                <p className="text-muted-foreground mt-3">
                  This device app is disabled or outside your current access scope.
                </p>
                <p className="text-muted-foreground mt-2">
                  Sysadmin can enable the app for this device. Scoped admins can then grant
                  app-level read or write access.
                </p>
              </section>
            )}
          </div>
        </WorkspaceShell>
      </DeviceRouteContext.Provider>
    </CloudTransportProvider>
  );
};
