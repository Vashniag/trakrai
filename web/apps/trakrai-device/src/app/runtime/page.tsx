'use client';

import { DeviceRuntimePage } from '@trakrai/live-ui/components/device-runtime-page';

import { EdgeConsoleSurface } from '@/components/edge-console-surface';

const RuntimePage = () => (
  <EdgeConsoleSurface
    description="Managed runtime services, binary updates, and service control directly against the device transport."
    title="Runtime control"
  >
    {(runtimeConfig) => (
      <DeviceRuntimePage managementServiceName={runtimeConfig.managementService} />
    )}
  </EdgeConsoleSurface>
);

export default RuntimePage;
