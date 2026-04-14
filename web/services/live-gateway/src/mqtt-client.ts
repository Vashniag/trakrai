import mqtt from 'mqtt';
import {
  buildDeviceTopic,
  config,
  parseDeviceTopic,
  serviceName,
  subscribeTopicsForDevice,
} from './config.js';

export type MqttMessageHandler = (topic: string, payload: string) => void;

let client: mqtt.MqttClient | null = null;
const handlers = new Set<MqttMessageHandler>();
const subscriptionRefs = new Map<string, number>();

export function connectMqtt(): Promise<mqtt.MqttClient> {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(config.mqttBrokerUrl, {
      clientId: `${serviceName}-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
    });
    let settled = false;

    const resolveOnce = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(c);
    };

    const rejectOnce = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    c.on('connect', () => {
      console.log(`[mqtt] connected to ${config.mqttBrokerUrl}`);
      client = c;
      resolveOnce();
    });

    c.on('message', (topic, message) => {
      const payload = message.toString();
      for (const handler of handlers) {
        handler(topic, payload);
      }
    });

    c.on('error', (err) => {
      console.error('[mqtt] error:', err.message);
      rejectOnce(err);
    });

    c.on('reconnect', () => {
      console.log('[mqtt] reconnecting...');
    });

    c.on('close', () => {
      console.log('[mqtt] disconnected');
      rejectOnce(new Error('mqtt disconnected before initial connect'));
    });
  });
}

export function onMqttMessage(handler: MqttMessageHandler): void {
  handlers.add(handler);
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

  return new Promise((resolve, reject) => {
    client?.subscribe(subscribeTopicsForDevice(deviceId), { qos: 1 }, (err) => {
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

  client.unsubscribe(subscribeTopicsForDevice(deviceId));
  subscriptionRefs.delete(deviceId);
  console.log(`[mqtt] unsubscribed from ${deviceId}`);
}

export function publishMqtt(
  deviceId: string,
  subtopic: string,
  payload: string,
  service?: string | null,
): void {
  if (!client) {
    console.error('[mqtt] not connected, cannot publish');
    return;
  }

  client.publish(buildDeviceTopic(deviceId, subtopic, service), payload, { qos: 1 });
}

export function getMqttClient(): mqtt.MqttClient | null {
  return client;
}

export { parseDeviceTopic };
