import { env } from '@/lib/env';
import type { DeviceTransportMode, DeviceUiBuildConfig } from '@/lib/runtime-config';

const DEFAULT_LOCAL_DEVICE_HTTP_PORT = '18080';
const DEFAULT_CLOUD_API_BASE_URL = 'http://localhost:3000';
const DEFAULT_MANAGEMENT_SERVICE = 'runtime-manager';

const normalizeOptionalString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === '' ? undefined : normalized;
};

const normalizeString = (value: string | undefined, fallback: string): string =>
  normalizeOptionalString(value) ?? fallback;

const normalizeMode = (
  value: string | undefined,
  fallback: DeviceTransportMode,
): DeviceTransportMode => (value === 'cloud' || value === 'edge' ? value : fallback);

const normalizeBoolean = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return fallback;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/$/, '');

export const deviceUiBuildConfig: DeviceUiBuildConfig = {
  cloudApiBaseUrl: trimTrailingSlash(
    normalizeString(env.NEXT_PUBLIC_TRAKRAI_CLOUD_API_URL, DEFAULT_CLOUD_API_BASE_URL),
  ),
  cloudBridgeUrl: normalizeString(
    env.NEXT_PUBLIC_TRAKRAI_CLOUD_BRIDGE_URL,
    'ws://127.0.0.1:8090/ws',
  ),
  configuredEdgeBridgeUrl: normalizeOptionalString(env.NEXT_PUBLIC_TRAKRAI_EDGE_BRIDGE_URL),
  deviceId: normalizeString(env.NEXT_PUBLIC_TRAKRAI_DEVICE_ID, 'trakrai-device-local'),
  diagnosticsEnabled: normalizeBoolean(env.NEXT_PUBLIC_TRAKRAI_ENABLE_DIAGNOSTICS, true),
  enableTrpcLogger: env.NODE_ENV === 'development',
  isDevelopment: env.NODE_ENV === 'development',
  localDeviceHttpPort: normalizeString(
    env.NEXT_PUBLIC_TRAKRAI_LOCAL_DEVICE_HTTP_PORT,
    DEFAULT_LOCAL_DEVICE_HTTP_PORT,
  ),
  managementService: DEFAULT_MANAGEMENT_SERVICE,
  runtimeConfigUrl: normalizeOptionalString(env.NEXT_PUBLIC_TRAKRAI_RUNTIME_CONFIG_URL),
  transportMode: normalizeMode(env.NEXT_PUBLIC_TRAKRAI_DEVICE_TRANSPORT_MODE, 'edge'),
};
