import mqtt from 'mqtt';
import { config, mqttTopics, parseDeviceTopic } from './config.js';

export type MqttMessageHandler = (topic: string, payload: string) => void;

let client: mqtt.MqttClient | null = null;
const handlers: MqttMessageHandler[] = [];
const subscriptionRefs = new Map<string, number>();

export function connectMqtt(): Promise<mqtt.MqttClient> {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(config.mqttBrokerUrl, {
      clientId: `live-feeder-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
    });

    c.on('connect', () => {
      console.log(`[mqtt] connected to ${config.mqttBrokerUrl}`);
      client = c;
      resolve(c);
    });

    c.on('message', (topic, message) => {
      const payload = message.toString();
      for (const handler of handlers) {
        handler(topic, payload);
      }
    });

    c.on('error', (err) => {
      console.error('[mqtt] error:', err.message);
    });

    c.on('reconnect', () => {
      console.log('[mqtt] reconnecting...');
    });

    c.on('close', () => {
      console.log('[mqtt] disconnected');
    });
  });
}

export function onMqttMessage(handler: MqttMessageHandler): void {
  handlers.push(handler);
}

export function subscribeToDevice(deviceId: string): Promise<void> {
  if (!client) {
    return Promise.reject(new Error('mqtt client not connected'));
  }

  const nextRefCount = (subscriptionRefs.get(deviceId) ?? 0) + 1;
  subscriptionRefs.set(deviceId, nextRefCount);

  if (nextRefCount > 1) {
    return Promise.resolve();
  }

  const topics = mqttTopics(deviceId);
  const subscribeTopics = [topics.response, topics.status, topics.webrtcOffer, topics.webrtcIce];

  return new Promise((resolve, reject) => {
    client?.subscribe(subscribeTopics, { qos: 1 }, (err) => {
      if (err) {
        subscriptionRefs.delete(deviceId);
        reject(err);
        return;
      }
      console.log(`[mqtt] subscribed to ${deviceId}`);
      resolve();
    });
  });
}

export function unsubscribeFromDevice(deviceId: string): void {
  if (!client) {
    return;
  }

  const currentRefCount = subscriptionRefs.get(deviceId);
  if (currentRefCount === undefined) {
    return;
  }

  if (currentRefCount > 1) {
    subscriptionRefs.set(deviceId, currentRefCount - 1);
    return;
  }

  const topics = mqttTopics(deviceId);
  client.unsubscribe([topics.response, topics.status, topics.webrtcOffer, topics.webrtcIce]);
  subscriptionRefs.delete(deviceId);
  console.log(`[mqtt] unsubscribed from ${deviceId}`);
}

export function publishMqtt(
  deviceId: string,
  topicType: keyof ReturnType<typeof mqttTopics>,
  payload: string,
): void {
  if (!client) {
    console.error('[mqtt] not connected, cannot publish');
    return;
  }

  const topics = mqttTopics(deviceId);
  client.publish(topics[topicType], payload, { qos: 1 });
}

export function getMqttClient(): mqtt.MqttClient | null {
  return client;
}

export { parseDeviceTopic };
