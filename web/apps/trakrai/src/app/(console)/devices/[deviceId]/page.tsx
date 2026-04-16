import { DeviceWorkspacePage } from '@/components/workspace-pages';

const DevicePage = async ({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) => {
  const { deviceId } = await params;

  return <DeviceWorkspacePage deviceId={deviceId} />;
};

export default DevicePage;
