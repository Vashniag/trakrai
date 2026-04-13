const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsedValue = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsedValue) ? fallback : parsedValue;
};

export const serviceName = 'live-gateway';

export const config = {
  port: parseNumber(process.env['PORT'], 4000),
  mqttBrokerUrl: process.env['MQTT_BROKER_URL'] ?? 'mqtt://localhost:1883',
  corsOrigin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
  defaultDeviceId: process.env['DEVICE_ID'] ?? 'default',
  turn: {
    url: process.env['TURN_SERVER_URL'] ?? 'turn:127.0.0.1:3478',
    username: process.env['TURN_USERNAME'] ?? 'trakrai',
    credential: process.env['TURN_CREDENTIAL'] ?? 'trakrai-secret',
  },
} as const;

export type DeviceTopicType =
  | 'command'
  | 'response'
  | 'status'
  | 'webrtcOffer'
  | 'webrtcAnswer'
  | 'webrtcIce';

export const deviceTopics = (deviceId: string): Record<DeviceTopicType, string> => ({
  command: `trakrai/device/${deviceId}/command`,
  response: `trakrai/device/${deviceId}/response`,
  status: `trakrai/device/${deviceId}/status`,
  webrtcOffer: `trakrai/device/${deviceId}/webrtc/offer`,
  webrtcAnswer: `trakrai/device/${deviceId}/webrtc/answer`,
  webrtcIce: `trakrai/device/${deviceId}/webrtc/ice`,
});

export const subscribeTopicsForDevice = (deviceId: string): string[] => {
  const topics = deviceTopics(deviceId);
  return [topics.response, topics.status, topics.webrtcOffer, topics.webrtcIce];
};

export const parseDeviceTopic = (
  topic: string,
): { deviceId: string; topicType: DeviceTopicType } | null => {
  const match =
    /^trakrai\/device\/([^/]+)\/(command|response|status|webrtc\/offer|webrtc\/answer|webrtc\/ice)$/.exec(
      topic,
    );
  if (match === null) {
    return null;
  }

  const [, deviceId, suffix] = match;
  const topicTypeMap: Record<string, DeviceTopicType> = {
    command: 'command',
    response: 'response',
    status: 'status',
    'webrtc/offer': 'webrtcOffer',
    'webrtc/answer': 'webrtcAnswer',
    'webrtc/ice': 'webrtcIce',
  };

  return { deviceId, topicType: topicTypeMap[suffix] };
};
