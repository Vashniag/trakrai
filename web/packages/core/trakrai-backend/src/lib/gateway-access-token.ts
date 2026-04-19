import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const LIVE_GATEWAY_AUDIENCE = 'trakrai-live-gateway';
const LIVE_GATEWAY_ISSUER = 'trakrai-backend';
const SECONDS_PER_MINUTE = 60;
const DEFAULT_TOKEN_TTL_MINUTES = 10;
const DEFAULT_TOKEN_TTL_SECONDS = SECONDS_PER_MINUTE * DEFAULT_TOKEN_TTL_MINUTES;

export type DeviceGatewayAccessTokenPayload = Readonly<{
  allowedSelectors: string[];
  allowedServiceNames: string[];
  deviceId: string;
  userId: string;
}>;

type ParsedGatewayTokenPayload = DeviceGatewayAccessTokenPayload & {
  exp?: number;
  iat?: number;
};

const readRequiredSecret = (): Uint8Array => {
  const secret = process.env.LIVE_GATEWAY_AUTH_SECRET?.trim();
  if (secret === undefined || secret === '') {
    throw new Error('LIVE_GATEWAY_AUTH_SECRET is required.');
  }

  return new TextEncoder().encode(secret);
};

const normalizeStringList = (values: readonly string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter((value) => value !== ''))).sort();

export const createTransportActionSelector = (
  serviceName: string,
  subtopic: string,
  type: string,
): string | null => {
  const normalizedServiceName = serviceName.trim();
  const normalizedSubtopic = subtopic.trim();
  const normalizedType = type.trim();

  if (
    normalizedServiceName === '' ||
    normalizedSubtopic === '' ||
    normalizedType === '' ||
    normalizedServiceName.includes(':') ||
    normalizedSubtopic.includes(':') ||
    normalizedType.includes(':')
  ) {
    return null;
  }

  return `${normalizedServiceName}:${normalizedSubtopic}:${normalizedType}`;
};

export const signDeviceGatewayAccessToken = async (
  payload: DeviceGatewayAccessTokenPayload,
  options?: Readonly<{
    expiresInSeconds?: number;
  }>,
): Promise<string> => {
  const expiresInSeconds =
    options?.expiresInSeconds !== undefined && options.expiresInSeconds > 0
      ? options.expiresInSeconds
      : DEFAULT_TOKEN_TTL_SECONDS;

  return new SignJWT({
    allowedSelectors: normalizeStringList(payload.allowedSelectors),
    allowedServiceNames: normalizeStringList(payload.allowedServiceNames),
    deviceId: payload.deviceId.trim(),
    userId: payload.userId.trim(),
  } satisfies JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience(LIVE_GATEWAY_AUDIENCE)
    .setIssuer(LIVE_GATEWAY_ISSUER)
    .setSubject(payload.userId.trim())
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(readRequiredSecret());
};

export const verifyDeviceGatewayAccessToken = async (
  token: string,
): Promise<ParsedGatewayTokenPayload> => {
  const { payload } = await jwtVerify(token, readRequiredSecret(), {
    audience: LIVE_GATEWAY_AUDIENCE,
    issuer: LIVE_GATEWAY_ISSUER,
  });

  const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
  const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
  const allowedServiceNames = Array.isArray(payload.allowedServiceNames)
    ? payload.allowedServiceNames.filter((value): value is string => typeof value === 'string')
    : [];
  const allowedSelectors = Array.isArray(payload.allowedSelectors)
    ? payload.allowedSelectors.filter((value): value is string => typeof value === 'string')
    : [];

  if (userId === '' || deviceId === '') {
    throw new Error('Live gateway access token payload is invalid.');
  }

  return {
    allowedSelectors: normalizeStringList(allowedSelectors),
    allowedServiceNames: normalizeStringList(allowedServiceNames),
    deviceId,
    exp: payload.exp,
    iat: payload.iat,
    userId,
  };
};
