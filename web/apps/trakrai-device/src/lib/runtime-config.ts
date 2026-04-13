export type DeviceTransportMode = 'cloud' | 'edge';

export type DeviceUiRuntimeConfig = {
  cloudBridgeUrl: string;
  deviceId: string;
  diagnosticsEnabled: boolean;
  edgeBridgeUrl: string;
  transportMode: DeviceTransportMode;
};

type WindowRuntimeConfig = Partial<DeviceUiRuntimeConfig> & {
  diagnosticsEnabled?: boolean | string;
  transportMode?: string;
};

declare global {
  interface Window {
    __TRAKRAI_DEVICE_UI_CONFIG__?: WindowRuntimeConfig;
  }
}

const normalizeString = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim();

  return normalized !== undefined && normalized !== '' ? normalized : fallback;
};

const normalizeMode = (
  value: string | undefined,
  fallback: DeviceTransportMode,
): DeviceTransportMode => (value === 'cloud' || value === 'edge' ? value : fallback);

const normalizeBoolean = (value: boolean | string | undefined, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return fallback;
};

export const DEFAULT_DEVICE_UI_RUNTIME_CONFIG: DeviceUiRuntimeConfig = {
  deviceId: normalizeString(process.env.NEXT_PUBLIC_TRAKRAI_DEVICE_ID, 'trakrai-device-local'),
  transportMode: normalizeMode(process.env.NEXT_PUBLIC_TRAKRAI_DEVICE_TRANSPORT_MODE, 'edge'),
  cloudBridgeUrl: normalizeString(
    process.env.NEXT_PUBLIC_TRAKRAI_CLOUD_BRIDGE_URL,
    'ws://127.0.0.1:8090/ws',
  ),
  edgeBridgeUrl: normalizeString(
    process.env.NEXT_PUBLIC_TRAKRAI_EDGE_BRIDGE_URL,
    'http://127.0.0.1:8080',
  ),
  diagnosticsEnabled: normalizeBoolean(process.env.NEXT_PUBLIC_TRAKRAI_ENABLE_DIAGNOSTICS, true),
};

export const readDeviceUiRuntimeConfig = (): DeviceUiRuntimeConfig => {
  if (typeof window === 'undefined') {
    return DEFAULT_DEVICE_UI_RUNTIME_CONFIG;
  }

  const runtimeConfig = window.__TRAKRAI_DEVICE_UI_CONFIG__;

  return {
    deviceId: normalizeString(runtimeConfig?.deviceId, DEFAULT_DEVICE_UI_RUNTIME_CONFIG.deviceId),
    transportMode: normalizeMode(
      runtimeConfig?.transportMode,
      DEFAULT_DEVICE_UI_RUNTIME_CONFIG.transportMode,
    ),
    cloudBridgeUrl: normalizeString(
      runtimeConfig?.cloudBridgeUrl,
      DEFAULT_DEVICE_UI_RUNTIME_CONFIG.cloudBridgeUrl,
    ),
    edgeBridgeUrl: normalizeString(
      runtimeConfig?.edgeBridgeUrl,
      DEFAULT_DEVICE_UI_RUNTIME_CONFIG.edgeBridgeUrl,
    ),
    diagnosticsEnabled: normalizeBoolean(
      runtimeConfig?.diagnosticsEnabled,
      DEFAULT_DEVICE_UI_RUNTIME_CONFIG.diagnosticsEnabled,
    ),
  };
};

export const getActiveTransportEndpoint = (config: DeviceUiRuntimeConfig): string =>
  config.transportMode === 'cloud' ? config.cloudBridgeUrl : config.edgeBridgeUrl;
