'use client';

import { DeviceRuntimePage } from '@trakrai/live-ui/components/device-runtime-page';

import { cloudAppBuildConfig } from '@/lib/build-config';
import { useTRPCQuery } from '@/server/react';

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
