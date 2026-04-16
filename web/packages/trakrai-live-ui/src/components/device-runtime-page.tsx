'use client';

import { DeviceServicesPanel } from '@trakrai/runtime-manager-ui/components/device-services-panel';
import {
  RuntimeManagerPanel,
  type RuntimeManagerPackageCatalogState,
} from '@trakrai/runtime-manager-ui/components/runtime-manager-panel';
import { useRuntimeManager } from '@trakrai/runtime-manager-ui/hooks/use-runtime-manager';

export type DeviceRuntimePageProps = Readonly<{
  managementServiceName: string;
  packageCatalog?: RuntimeManagerPackageCatalogState;
}>;

export const DeviceRuntimePage = ({
  managementServiceName,
  packageCatalog,
}: DeviceRuntimePageProps) => {
  const manager = useRuntimeManager(managementServiceName);

  return (
    <div className="space-y-5">
      <DeviceServicesPanel managedServices={manager.services} />
      <RuntimeManagerPanel manager={manager} packageCatalog={packageCatalog} />
    </div>
  );
};
