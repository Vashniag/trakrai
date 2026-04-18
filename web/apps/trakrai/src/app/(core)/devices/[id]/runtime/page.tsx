'use client';

import { DeviceServicesPanel } from '@trakrai/runtime-manager-ui/components/device-services-panel';
import {
  RuntimeManagerPanel,
  type RuntimeManagerPackageCatalogState,
} from '@trakrai/runtime-manager-ui/components/runtime-manager-panel';
import { useRuntimeManager } from '@trakrai/runtime-manager-ui/hooks/use-runtime-manager';

import { cloudAppBuildConfig } from '@/lib/build-config';
import { useTRPCQuery } from '@/server/react';

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

const DeviceRuntimeRoutePage = () => {
  const packageCatalogQuery = useTRPCQuery((api) =>
    api.packageArtifacts.listAvailable.queryOptions({}),
  );

  return (
    <DeviceRuntimePage
      managementServiceName={cloudAppBuildConfig.managementServiceName}
      packageCatalog={{
        artifacts: packageCatalogQuery.data?.artifacts ?? [],
        error:
          packageCatalogQuery.error instanceof Error ? packageCatalogQuery.error.message : null,
        isLoading: packageCatalogQuery.isLoading,
      }}
    />
  );
};

export default DeviceRuntimeRoutePage;
