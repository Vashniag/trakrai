import { env } from '@/lib/env';

const DEFAULT_LIVE_GATEWAY_BASE_URL = 'http://localhost:4000';
const DEFAULT_MANAGEMENT_SERVICE_NAME = 'runtime-manager';
const DEFAULT_ICE_TRANSPORT_POLICY = 'all';

const normalizeOptionalString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === '' ? undefined : normalized;
};

const normalizeString = (value: string | undefined, fallback: string): string =>
  normalizeOptionalString(value) ?? fallback;

const trimTrailingSlash = (value: string): string => value.replace(/\/$/, '');

const toWebSocketUrl = (baseUrl: string): string => {
  const resolvedUrl = new URL(baseUrl);
  resolvedUrl.protocol = resolvedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  resolvedUrl.pathname =
    resolvedUrl.pathname === '/' ? '/ws' : `${trimTrailingSlash(resolvedUrl.pathname)}/ws`;
  resolvedUrl.search = '';
  resolvedUrl.hash = '';
  return resolvedUrl.toString();
};

const liveGatewayBaseUrl = trimTrailingSlash(
  normalizeString(env.NEXT_PUBLIC_TRAKRAI_CLOUD_GATEWAY_BASE_URL, DEFAULT_LIVE_GATEWAY_BASE_URL),
);

export const cloudAppBuildConfig = {
  enableTrpcLogger: env.NODE_ENV === 'development',
  iceTransportPolicy: DEFAULT_ICE_TRANSPORT_POLICY,
  liveGatewayHttpUrl: liveGatewayBaseUrl,
  liveGatewayWsUrl: toWebSocketUrl(liveGatewayBaseUrl),
  managementServiceName: DEFAULT_MANAGEMENT_SERVICE_NAME,
  port: String(env.PORT),
  publicBaseUrl: normalizeOptionalString(env.NEXT_PUBLIC_BASE_URL),
  vercelProjectProductionUrl: normalizeOptionalString(
    env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  ),
} as const;
