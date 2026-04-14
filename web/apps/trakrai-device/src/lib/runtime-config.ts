export type DeviceTransportMode = 'cloud' | 'edge';

export type DeviceUiRuntimeConfig = {
  cloudBridgeUrl: string;
  deviceId: string;
  diagnosticsEnabled: boolean;
  edgeBridgeUrl: string;
  managementService: string;
  transportMode: DeviceTransportMode;
};

export type ResolvedDeviceUiTransport = {
  endpoint: string;
  httpBaseUrl: string;
  signalingUrl: string;
};

const WS_PATH_SUFFIX = '/ws';
const DEFAULT_RUNTIME_CONFIG_PATH = '/api/runtime-config';
const DEFAULT_LOCAL_DEVICE_HTTP_PORT = '18080';
const REMOTE_RUNTIME_CONFIG_URL = process.env.NEXT_PUBLIC_TRAKRAI_RUNTIME_CONFIG_URL;

type WindowRuntimeConfig = Partial<DeviceUiRuntimeConfig> & {
  diagnosticsEnabled?: boolean | string;
  managementService?: string;
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

const LOCAL_DEVICE_HTTP_PORT = normalizeString(
  process.env.NEXT_PUBLIC_TRAKRAI_LOCAL_DEVICE_HTTP_PORT,
  DEFAULT_LOCAL_DEVICE_HTTP_PORT,
);

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

const trimTrailingSlash = (value: string): string => value.replace(/\/$/, '');

const normalizeManagementService = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim();
  return normalized !== undefined && normalized !== '' ? normalized : fallback;
};

const normalizePath = (pathName: string): string => {
  const trimmed = pathName.replace(/\/$/, '');
  return trimmed === '/' ? '' : trimmed;
};

const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value);
const isDevelopment = (): boolean => process.env.NODE_ENV === 'development';
const readBrowserHostname = (): string =>
  typeof window === 'undefined'
    ? '127.0.0.1'
    : normalizeString(window.location.hostname, '127.0.0.1');

const buildLocalDevDeviceBaseUrl = (): string =>
  `http://${readBrowserHostname()}:${LOCAL_DEVICE_HTTP_PORT}`;

const resolveDefaultEdgeBridgeUrl = (): string => {
  const configuredUrl = process.env.NEXT_PUBLIC_TRAKRAI_EDGE_BRIDGE_URL?.trim();
  if (configuredUrl !== undefined && configuredUrl !== '') {
    return configuredUrl;
  }

  return isDevelopment() ? buildLocalDevDeviceBaseUrl() : 'http://127.0.0.1:8080';
};

const resolveRuntimeConfigUrl = (): string => {
  const remoteRuntimeConfigUrl = REMOTE_RUNTIME_CONFIG_URL?.trim();
  if (remoteRuntimeConfigUrl !== undefined && remoteRuntimeConfigUrl !== '') {
    return remoteRuntimeConfigUrl;
  }

  return isDevelopment()
    ? `${buildLocalDevDeviceBaseUrl()}${DEFAULT_RUNTIME_CONFIG_PATH}`
    : DEFAULT_RUNTIME_CONFIG_PATH;
};

const ensureWsPath = (pathName: string): string =>
  pathName.endsWith(WS_PATH_SUFFIX) ? pathName : `${normalizePath(pathName)}${WS_PATH_SUFFIX}`;

const stripWsPath = (pathName: string): string =>
  pathName.endsWith(WS_PATH_SUFFIX)
    ? normalizePath(pathName.slice(0, -WS_PATH_SUFFIX.length))
    : normalizePath(pathName);

const deriveTransportUrls = (endpoint: string): ResolvedDeviceUiTransport => {
  const normalizedEndpoint = trimTrailingSlash(endpoint.trim());
  const parsedUrl = new URL(normalizedEndpoint);

  if (parsedUrl.protocol === 'ws:' || parsedUrl.protocol === 'wss:') {
    const httpProtocol = parsedUrl.protocol === 'wss:' ? 'https:' : 'http:';
    const httpPath = stripWsPath(parsedUrl.pathname);

    return {
      endpoint: normalizedEndpoint,
      httpBaseUrl: `${httpProtocol}//${parsedUrl.host}${httpPath}`,
      signalingUrl: `${parsedUrl.protocol}//${parsedUrl.host}${ensureWsPath(parsedUrl.pathname)}`,
    };
  }

  const signalingProtocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const httpPath = stripWsPath(parsedUrl.pathname);

  return {
    endpoint: normalizedEndpoint,
    httpBaseUrl: `${parsedUrl.protocol}//${parsedUrl.host}${httpPath}`,
    signalingUrl: `${signalingProtocol}//${parsedUrl.host}${ensureWsPath(parsedUrl.pathname)}`,
  };
};

export const getDefaultDeviceUiRuntimeConfig = (): DeviceUiRuntimeConfig => ({
  deviceId: normalizeString(process.env.NEXT_PUBLIC_TRAKRAI_DEVICE_ID, 'trakrai-device-local'),
  transportMode: normalizeMode(process.env.NEXT_PUBLIC_TRAKRAI_DEVICE_TRANSPORT_MODE, 'edge'),
  cloudBridgeUrl: normalizeString(
    process.env.NEXT_PUBLIC_TRAKRAI_CLOUD_BRIDGE_URL,
    'ws://127.0.0.1:8090/ws',
  ),
  edgeBridgeUrl: normalizeString(
    process.env.NEXT_PUBLIC_TRAKRAI_EDGE_BRIDGE_URL,
    resolveDefaultEdgeBridgeUrl(),
  ),
  diagnosticsEnabled: normalizeBoolean(process.env.NEXT_PUBLIC_TRAKRAI_ENABLE_DIAGNOSTICS, true),
  managementService: normalizeManagementService(
    process.env.NEXT_PUBLIC_TRAKRAI_MANAGEMENT_SERVICE,
    'runtime-manager',
  ),
});

const normalizeRuntimeConfig = (
  runtimeConfig: WindowRuntimeConfig | undefined,
): DeviceUiRuntimeConfig => {
  const defaultRuntimeConfig = getDefaultDeviceUiRuntimeConfig();

  return {
    deviceId: normalizeString(runtimeConfig?.deviceId, defaultRuntimeConfig.deviceId),
    transportMode: normalizeMode(runtimeConfig?.transportMode, defaultRuntimeConfig.transportMode),
    cloudBridgeUrl: normalizeString(
      runtimeConfig?.cloudBridgeUrl,
      defaultRuntimeConfig.cloudBridgeUrl,
    ),
    edgeBridgeUrl: normalizeString(
      runtimeConfig?.edgeBridgeUrl,
      defaultRuntimeConfig.edgeBridgeUrl,
    ),
    diagnosticsEnabled: normalizeBoolean(
      runtimeConfig?.diagnosticsEnabled,
      defaultRuntimeConfig.diagnosticsEnabled,
    ),
    managementService: normalizeManagementService(
      runtimeConfig?.managementService,
      defaultRuntimeConfig.managementService,
    ),
  };
};

export const readDeviceUiRuntimeConfig = (): DeviceUiRuntimeConfig => {
  if (typeof window === 'undefined') {
    return getDefaultDeviceUiRuntimeConfig();
  }

  return normalizeRuntimeConfig(window.__TRAKRAI_DEVICE_UI_CONFIG__);
};

export const loadDeviceUiRuntimeConfig = async (
  signal?: AbortSignal,
): Promise<DeviceUiRuntimeConfig> => {
  const fallbackConfig = readDeviceUiRuntimeConfig();

  if (typeof window === 'undefined') {
    return fallbackConfig;
  }

  try {
    const runtimeConfigUrl = resolveRuntimeConfigUrl();
    const response = await fetch(runtimeConfigUrl, {
      cache: 'no-store',
      credentials: isAbsoluteUrl(runtimeConfigUrl) ? 'omit' : 'same-origin',
      signal,
    });
    if (!response.ok) {
      return fallbackConfig;
    }

    const runtimeConfig = (await response.json()) as WindowRuntimeConfig;
    return normalizeRuntimeConfig(runtimeConfig);
  } catch {
    return fallbackConfig;
  }
};

export const getActiveTransportEndpoint = (config: DeviceUiRuntimeConfig): string =>
  config.transportMode === 'cloud' ? config.cloudBridgeUrl : config.edgeBridgeUrl;

export const resolveDeviceUiTransport = (
  config: DeviceUiRuntimeConfig,
): ResolvedDeviceUiTransport => deriveTransportUrls(getActiveTransportEndpoint(config));
