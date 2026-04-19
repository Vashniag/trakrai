'use client';

import { createContext, useContext, type ReactNode } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
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
  description: string;
  href: string;
  label: string;
}> =>
  [
    {
      description: 'Basic device details, lifecycle data, and app index.',
      href: `/devices/${deviceRecordId}`,
      label: 'Home',
    },
    ...routeContext.components
      .filter((component) => component.routePath !== null && component.routePath.trim() !== '')
      .map((component) => ({
        description:
          component.description !== null && component.description.trim() !== ''
            ? component.description
            : `${component.navigationLabel} device app.`,
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
              <StatCard
                description="Installed device applications."
                title="Installed Apps"
                value={routeContext.stats.totalAppCount}
              />
              <StatCard
                description="Applications currently enabled on this device."
                title="Enabled Apps"
                value={routeContext.stats.enabledAppCount}
              />
              <StatCard
                description="Apps visible to the current signed-in user."
                title="Visible Apps"
                value={routeContext.stats.visibleAppCount}
              />
              <StatCard
                description="Direct device-level viewers."
                title="Direct Users"
                value={routeContext.stats.directUserCount}
              />
            </>
          }
          title={device.name}
        >
          <section className="flex flex-wrap gap-3">
            {routeItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  className={`border px-4 py-3 text-left transition ${isActive ? ACTIVE_CLASSES : IDLE_CLASSES}`}
                  href={item.href}
                >
                  <div className="font-medium">{item.label}</div>
                  <div className="text-muted-foreground mt-1 text-xs">{item.description}</div>
                </Link>
              );
            })}
          </section>

          {currentRouteAllowed ? (
            children
          ) : (
            <Card className="border">
              <CardHeader className="border-b">
                <CardTitle>Device app unavailable</CardTitle>
                <CardDescription>
                  This device app is disabled or outside your current access scope.
                </CardDescription>
              </CardHeader>
              <CardContent className="py-6 text-sm">
                Sysadmin can enable the app for this device. Scoped admins can then grant app-level
                read or write access.
              </CardContent>
            </Card>
          )}
        </WorkspaceShell>
      </DeviceRouteContext.Provider>
    </CloudTransportProvider>
  );
};
