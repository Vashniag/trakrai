import { DeviceRouteShell } from '@/components/device-route-shell';

const DeviceRouteLayout = async ({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}>) => {
  const { id } = await params;

  return <DeviceRouteShell deviceRecordId={id}>{children}</DeviceRouteShell>;
};

export default DeviceRouteLayout;
