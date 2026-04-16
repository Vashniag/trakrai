'use client';

import { DeviceRuntimePage } from '@trakrai/live-ui/components/device-runtime-page';

import { EdgeConsoleSurface } from '@/components/edge-console-surface';
import { CloudPackageApiProvider, useCloudPackageCatalog } from '@/lib/cloud-package-api';

const RuntimePageBody = ({
  managementServiceName,
}: Readonly<{
  managementServiceName: string;
}>) => {
  const packageCatalog = useCloudPackageCatalog();

  return (
    <DeviceRuntimePage
      managementServiceName={managementServiceName}
      packageCatalog={packageCatalog}
    />
  );
};

const RuntimePage = () => (
  <EdgeConsoleSurface
    description="Managed runtime services, binary updates, and service control directly against the device transport."
    title="Runtime control"
  >
    {(runtimeConfig) => (
      <CloudPackageApiProvider>
        <RuntimePageBody managementServiceName={runtimeConfig.managementService} />
      </CloudPackageApiProvider>
    )}
  </EdgeConsoleSurface>
);

export default RuntimePage;
