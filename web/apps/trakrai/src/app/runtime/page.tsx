'use client';

import { DeviceRuntimePage } from '@trakrai/live-ui/components/device-runtime-page';

import { CloudConsoleSurface } from '@/components/cloud-console-surface';
import { cloudAppBuildConfig } from '@/lib/build-config';
import { useTRPCQuery } from '@/server/react';

const CloudRuntimePageBody = () => {
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

const RuntimePage = () => (
  <CloudConsoleSurface
    description="Runtime service health, controller actions, and managed binary definitions through the cloud transport."
    title="Runtime control"
  >
    <CloudRuntimePageBody />
  </CloudConsoleSurface>
);

export default RuntimePage;
