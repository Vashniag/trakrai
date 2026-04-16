import { env } from './env.js';

const parseOptionalEnvValue = (value: string | undefined): string | null => {
  const normalizedValue = value?.trim();
  return normalizedValue !== undefined && normalizedValue !== '' ? normalizedValue : null;
};

const isLoopbackHostname = (hostname: string): boolean => {
  const normalizedHostname = hostname.trim().toLowerCase();
  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname === '::1' ||
    normalizedHostname === '0.0.0.0'
  );
};

const getTurnHostname = (turnUrl: string): string | null => {
  const normalizedTurnUrl = turnUrl.trim();
  if (normalizedTurnUrl === '') {
    return null;
  }

  const schemeSeparatorIndex = normalizedTurnUrl.indexOf(':');
  if (schemeSeparatorIndex <= 0) {
    return null;
  }

  const authority = normalizedTurnUrl.slice(schemeSeparatorIndex + 1).replace(/^\/\//, '');
  const atIndex = authority.lastIndexOf('@');
  const hostPort = atIndex >= 0 ? authority.slice(atIndex + 1) : authority;
  if (hostPort === '') {
    return null;
  }

  if (hostPort.startsWith('[')) {
    const closingBracketIndex = hostPort.indexOf(']');
    return closingBracketIndex > 1 ? hostPort.slice(1, closingBracketIndex) : null;
  }

  const colonIndex = hostPort.lastIndexOf(':');
  return colonIndex > 0 ? hostPort.slice(0, colonIndex) : hostPort;
};

const resolveTurnConfig = (): { credential: string; url: string; username: string } | null => {
  const turnUrl = parseOptionalEnvValue(env.TURN_SERVER_URL);
  if (turnUrl === null) {
    return null;
  }

  const hostname = getTurnHostname(turnUrl);
  if (hostname !== null && isLoopbackHostname(hostname)) {
    console.warn(
      `[${serviceName}] TURN disabled because TURN_SERVER_URL points to loopback address ${hostname}.`,
    );
    return null;
  }

  return {
    credential: env.TURN_CREDENTIAL,
    url: turnUrl,
    username: env.TURN_USERNAME,
  };
};

export const serviceName = 'live-gateway';

export const config = {
  defaultDeviceId: env.DEVICE_ID,
  mqttBrokerUrl: env.MQTT_BROKER_URL,
  port: env.PORT,
  stunServerUrl: env.STUN_SERVER_URL,
  turn: resolveTurnConfig(),
  wsRateLimit: {
    maxCommandMessages: env.WS_RATE_LIMIT_MAX_COMMAND_MESSAGES,
    maxMessages: env.WS_RATE_LIMIT_MAX_MESSAGES,
    maxPayloadBytes: env.WS_MAX_PAYLOAD_BYTES,
    windowMs: env.WS_RATE_LIMIT_WINDOW_MS,
  },
} as const;

export type ParsedDeviceTopic = {
  deviceId: string;
  service: string | null;
  subtopic: string;
};

const topicBase = (deviceId: string, service?: string | null): string => {
  const normalizedDeviceId = deviceId.trim();
  const normalizedService = service?.trim() ?? '';
  return normalizedService !== ''
    ? `trakrai/device/${normalizedDeviceId}/service/${normalizedService}`
    : `trakrai/device/${normalizedDeviceId}`;
};

export const normalizeTopicSubtopic = (subtopic: string): string =>
  subtopic.replace(/^\/+/, '').trim();

export const buildDeviceTopic = (
  deviceId: string,
  subtopic: string,
  service?: string | null,
): string => {
  const normalizedSubtopic = normalizeTopicSubtopic(subtopic);
  if (normalizedSubtopic === '') {
    throw new Error('subtopic is required');
  }

  return `${topicBase(deviceId, service)}/${normalizedSubtopic}`;
};

export const subscribeTopicsForDevice = (deviceId: string): string[] => {
  const serviceWildcardBase = `${topicBase(deviceId)}/service/+`;
  return [
    buildDeviceTopic(deviceId, 'response'),
    buildDeviceTopic(deviceId, 'status'),
    `${serviceWildcardBase}/response`,
    `${serviceWildcardBase}/status`,
    `${serviceWildcardBase}/webrtc/offer`,
    `${serviceWildcardBase}/webrtc/ice`,
  ];
};

export const parseDeviceTopic = (topic: string): ParsedDeviceTopic | null => {
  const match =
    /^trakrai\/device\/([^/]+?)(?:\/service\/([^/]+))?\/(command|response|status|webrtc\/offer|webrtc\/answer|webrtc\/ice)$/.exec(
      topic,
    );
  if (match === null) {
    return null;
  }

  const [, deviceId, serviceSegment, subtopic] = match;
  return {
    deviceId,
    service: serviceSegment ?? null,
    subtopic,
  };
};
