'use client';

import { DeviceRuntimePage } from '@trakrai/live-ui/components/device-runtime-page';

import { CloudConsoleSurface } from '@/components/cloud-console-surface';

const configuredManagementService = process.env['NEXT_PUBLIC_TRAKRAI_MANAGEMENT_SERVICE']?.trim();
const MANAGEMENT_SERVICE_NAME =
  configuredManagementService === undefined || configuredManagementService === ''
    ? 'runtime-manager'
    : configuredManagementService;

const RuntimePage = () => (
  <CloudConsoleSurface
    description="Runtime service health, controller actions, and managed binary definitions through the cloud transport."
    title="Runtime control"
  >
    <DeviceRuntimePage managementServiceName={MANAGEMENT_SERVICE_NAME} />
  </CloudConsoleSurface>
);

export default RuntimePage;
