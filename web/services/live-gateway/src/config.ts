const normalizeEnvValue = (value: string | undefined, fallback: string): string => {
  const normalizedValue = value?.trim();
  return normalizedValue !== undefined && normalizedValue !== '' ? normalizedValue : fallback;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsedValue = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsedValue) ? fallback : parsedValue;
};

export const serviceName = 'live-gateway';

export const config = {
  port: parseNumber(process.env['PORT'], 4000),
  mqttBrokerUrl: normalizeEnvValue(process.env['MQTT_BROKER_URL'], 'mqtt://localhost:1883'),
  corsOrigin: normalizeEnvValue(process.env['CORS_ORIGIN'], 'http://localhost:3000'),
  defaultDeviceId: normalizeEnvValue(process.env['DEVICE_ID'], 'default'),
  turn: {
    url: normalizeEnvValue(process.env['TURN_SERVER_URL'], 'turn:127.0.0.1:3478'),
    username: normalizeEnvValue(process.env['TURN_USERNAME'], 'trakrai'),
    credential: normalizeEnvValue(process.env['TURN_CREDENTIAL'], 'trakrai-secret'),
  },
} as const;

export type DeviceTopicType =
  | 'command'
  | 'response'
  | 'status'
  | 'webrtcOffer'
  | 'webrtcAnswer'
  | 'webrtcIce';

type ParsedDeviceTopic = {
  deviceId: string;
  service: string | null;
  topicType: DeviceTopicType;
};

const topicBase = (deviceId: string, service?: string): string =>
  service !== undefined && service.trim() !== ''
    ? `trakrai/device/${deviceId}/service/${service}`
    : `trakrai/device/${deviceId}`;

export const deviceTopics = (
  deviceId: string,
  service?: string,
): Record<DeviceTopicType, string> => ({
  command: `${topicBase(deviceId, service)}/command`,
  response: `${topicBase(deviceId, service)}/response`,
  status: `${topicBase(deviceId, service)}/status`,
  webrtcOffer: `${topicBase(deviceId, service)}/webrtc/offer`,
  webrtcAnswer: `${topicBase(deviceId, service)}/webrtc/answer`,
  webrtcIce: `${topicBase(deviceId, service)}/webrtc/ice`,
});

export const subscribeTopicsForDevice = (deviceId: string): string[] => {
  const topics = deviceTopics(deviceId);
  const serviceWildcardBase = `${topicBase(deviceId)}/service/+`;
  return [
    topics.response,
    topics.status,
    topics.webrtcOffer,
    topics.webrtcIce,
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

  const [, deviceId, serviceSegment, suffix] = match;
  const topicTypeMap: Record<string, DeviceTopicType> = {
    command: 'command',
    response: 'response',
    status: 'status',
    'webrtc/offer': 'webrtcOffer',
    'webrtc/answer': 'webrtcAnswer',
    'webrtc/ice': 'webrtcIce',
  };

  return {
    deviceId,
    service: serviceSegment ?? null,
    topicType: topicTypeMap[suffix],
  };
};
