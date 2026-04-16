'use client';

import { CloudConsoleSurface } from '@/components/cloud-console-surface';
import { DeviceManagementPage } from '@/components/device-management-page';

const DevicesPage = () => (
  <CloudConsoleSurface
    description="Register cloud-managed devices, inspect their fixed access tokens, and control whether they are allowed to authenticate."
    title="Device management"
  >
    <DeviceManagementPage />
  </CloudConsoleSurface>
);

export default DevicesPage;
