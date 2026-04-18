'use client';

import { DeviceServicesPanel } from '@trakrai/runtime-manager-ui/components/device-services-panel';
import {
  RuntimeManagerPanel,
  type RuntimeManagerPackageCatalogState,
} from '@trakrai/runtime-manager-ui/components/runtime-manager-panel';
import { useRuntimeManager } from '@trakrai/runtime-manager-ui/hooks/use-runtime-manager';

import { EdgeConsoleSurface } from '@/components/edge-console-surface';
import { CloudPackageApiProvider, useCloudPackageCatalog } from '@/lib/cloud-package-api';
import { deviceUiBuildConfig } from '@/lib/device-ui-build-config';

type DeviceRuntimePageProps = Readonly<{
  managementServiceName: string;
  packageCatalog?: RuntimeManagerPackageCatalogState;
}>;

const DeviceRuntimePage = ({ managementServiceName, packageCatalog }: DeviceRuntimePageProps) => {
  const manager = useRuntimeManager(managementServiceName);

  return (
    <div className="space-y-5">
      <DeviceServicesPanel managedServices={manager.services} />
      <RuntimeManagerPanel manager={manager} packageCatalog={packageCatalog} />
    </div>
  );
};

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
      <CloudPackageApiProvider
        baseUrl={deviceUiBuildConfig.cloudApiBaseUrl}
        enableLogger={deviceUiBuildConfig.enableTrpcLogger}
      >
        <RuntimePageBody managementServiceName={runtimeConfig.managementService} />
      </CloudPackageApiProvider>
    )}
  </EdgeConsoleSurface>
);

export default RuntimePage;
