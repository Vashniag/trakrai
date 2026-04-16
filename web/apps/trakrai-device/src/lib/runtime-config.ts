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

export type DeviceUiBuildConfig = {
  cloudApiBaseUrl: string;
  cloudBridgeUrl: string;
  configuredEdgeBridgeUrl?: string;
  deviceId: string;
  diagnosticsEnabled: boolean;
  enableTrpcLogger: boolean;
  isDevelopment: boolean;
  localDeviceHttpPort: string;
  managementService: string;
  runtimeConfigUrl?: string;
  transportMode: DeviceTransportMode;
};

const WS_PATH_SUFFIX = '/ws';
const DEFAULT_RUNTIME_CONFIG_PATH = '/api/runtime-config';

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
const readBrowserHostname = (): string =>
  typeof window === 'undefined'
    ? '127.0.0.1'
    : normalizeString(window.location.hostname, '127.0.0.1');

const buildLocalDevDeviceBaseUrl = (localDeviceHttpPort: string): string =>
  `http://${readBrowserHostname()}:${localDeviceHttpPort}`;

const resolveDefaultEdgeBridgeUrl = (buildConfig: DeviceUiBuildConfig): string => {
  if (buildConfig.configuredEdgeBridgeUrl !== undefined) {
    return buildConfig.configuredEdgeBridgeUrl;
  }

  return buildConfig.isDevelopment
    ? buildLocalDevDeviceBaseUrl(buildConfig.localDeviceHttpPort)
    : 'http://127.0.0.1:8080';
};

const resolveRuntimeConfigUrl = (buildConfig: DeviceUiBuildConfig): string => {
  if (buildConfig.runtimeConfigUrl !== undefined) {
    return buildConfig.runtimeConfigUrl;
  }

  return buildConfig.isDevelopment
    ? `${buildLocalDevDeviceBaseUrl(buildConfig.localDeviceHttpPort)}${DEFAULT_RUNTIME_CONFIG_PATH}`
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

export const getDefaultDeviceUiRuntimeConfig = (
  buildConfig: DeviceUiBuildConfig,
): DeviceUiRuntimeConfig => ({
  deviceId: buildConfig.deviceId,
  transportMode: buildConfig.transportMode,
  cloudBridgeUrl: buildConfig.cloudBridgeUrl,
  edgeBridgeUrl: resolveDefaultEdgeBridgeUrl(buildConfig),
  diagnosticsEnabled: buildConfig.diagnosticsEnabled,
  managementService: buildConfig.managementService,
});

const normalizeRuntimeConfig = (
  runtimeConfig: WindowRuntimeConfig | undefined,
  defaultRuntimeConfig: DeviceUiRuntimeConfig,
): DeviceUiRuntimeConfig => {
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

export const readDeviceUiRuntimeConfig = (
  buildConfig: DeviceUiBuildConfig,
): DeviceUiRuntimeConfig => {
  const defaultRuntimeConfig = getDefaultDeviceUiRuntimeConfig(buildConfig);
  if (typeof window === 'undefined') {
    return defaultRuntimeConfig;
  }

  return normalizeRuntimeConfig(window.__TRAKRAI_DEVICE_UI_CONFIG__, defaultRuntimeConfig);
};

export const loadDeviceUiRuntimeConfig = async (
  buildConfig: DeviceUiBuildConfig,
  signal?: AbortSignal,
): Promise<DeviceUiRuntimeConfig> => {
  const fallbackConfig = readDeviceUiRuntimeConfig(buildConfig);

  if (typeof window === 'undefined') {
    return fallbackConfig;
  }

  try {
    const runtimeConfigUrl = resolveRuntimeConfigUrl(buildConfig);
    const response = await fetch(runtimeConfigUrl, {
      cache: 'no-store',
      credentials: isAbsoluteUrl(runtimeConfigUrl) ? 'omit' : 'same-origin',
      signal,
    });
    if (!response.ok) {
      return fallbackConfig;
    }

    const runtimeConfig = (await response.json()) as WindowRuntimeConfig;
    return normalizeRuntimeConfig(runtimeConfig, fallbackConfig);
  } catch {
    return fallbackConfig;
  }
};

export const getActiveTransportEndpoint = (config: DeviceUiRuntimeConfig): string =>
  config.transportMode === 'cloud' ? config.cloudBridgeUrl : config.edgeBridgeUrl;

export const resolveDeviceUiTransport = (
  config: DeviceUiRuntimeConfig,
): ResolvedDeviceUiTransport => deriveTransportUrls(getActiveTransportEndpoint(config));
