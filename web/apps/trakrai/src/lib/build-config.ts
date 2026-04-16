import { env } from '@/lib/env';

type CloudGatewayIceTransportPolicy = 'all' | 'relay';

const DEFAULT_LIVE_GATEWAY_WS_URL = 'ws://localhost:4000/ws';
const DEFAULT_LIVE_GATEWAY_HTTP_URL = 'http://localhost:4000';
const DEFAULT_MANAGEMENT_SERVICE_NAME = 'runtime-manager';

const normalizeOptionalString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === '' ? undefined : normalized;
};

const normalizeString = (value: string | undefined, fallback: string): string =>
  normalizeOptionalString(value) ?? fallback;

const trimTrailingSlash = (value: string): string => value.replace(/\/$/, '');

const firstDefined = (...values: Array<string | undefined>): string | undefined => {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  return undefined;
};

const normalizeIceTransportPolicy = (
  value: CloudGatewayIceTransportPolicy | undefined,
): CloudGatewayIceTransportPolicy => value ?? 'all';

export const cloudAppBuildConfig = {
  enableTrpcLogger: env.NODE_ENV === 'development',
  iceTransportPolicy: normalizeIceTransportPolicy(
    env.NEXT_PUBLIC_LIVE_GATEWAY_ICE_TRANSPORT_POLICY,
  ),
  liveGatewayHttpUrl: trimTrailingSlash(
    normalizeString(
      firstDefined(
        env.NEXT_PUBLIC_LIVE_GATEWAY_HTTP_URL,
        env.NEXT_PUBLIC_LIVE_FEEDER_HTTP_URL,
        env.NEXT_PUBLIC_MEDIATOR_HTTP_URL,
      ),
      DEFAULT_LIVE_GATEWAY_HTTP_URL,
    ),
  ),
  liveGatewayWsUrl: normalizeString(
    firstDefined(
      env.NEXT_PUBLIC_LIVE_GATEWAY_WS_URL,
      env.NEXT_PUBLIC_LIVE_FEEDER_WS_URL,
      env.NEXT_PUBLIC_MEDIATOR_WS_URL,
    ),
    DEFAULT_LIVE_GATEWAY_WS_URL,
  ),
  managementServiceName: normalizeString(
    env.NEXT_PUBLIC_TRAKRAI_MANAGEMENT_SERVICE,
    DEFAULT_MANAGEMENT_SERVICE_NAME,
  ),
  port: String(env.PORT),
  publicBaseUrl: normalizeOptionalString(env.NEXT_PUBLIC_BASE_URL),
  vercelProjectProductionUrl: normalizeOptionalString(
    env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  ),
} as const;
