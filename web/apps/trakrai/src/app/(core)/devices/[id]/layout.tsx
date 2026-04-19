import { DeviceRouteShell } from '@/components/device-route-shell';
import { fetchQuery } from '@/server/server';

const DeviceRouteLayout = async ({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}>) => {
  const { id } = await params;
  const routeContext = await fetchQuery((trpc) =>
    trpc.workspace.getDeviceWorkspace.queryOptions({
      deviceId: id,
    }),
  );

  return <DeviceRouteShell routeContext={routeContext}>{children}</DeviceRouteShell>;
};

export default DeviceRouteLayout;
