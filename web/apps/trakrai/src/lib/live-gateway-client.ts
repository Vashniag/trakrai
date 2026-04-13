type MessageHandler = (msg: { type: string; payload: unknown }) => void;

type StatusEvent =
  | { attempt: number; type: 'connecting' }
  | { type: 'open' }
  | { reason?: string; type: 'closed' }
  | { delayMs: number; type: 'reconnect-scheduled' }
  | { message?: string; type: 'error' };

type StatusHandler = (event: StatusEvent) => void;

const MAX_QUEUE_SIZE = 32;
const RECONNECT_DELAY_MS = 1500;

const normalizeGatewayUrl = (url: string): string => url.replace(/\s+(?=[?#]|$)/g, '').trim();

export class LiveGatewayClient {
  private ws: WebSocket | null = null;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly url: string;
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private outboundQueue: string[] = [];

  constructor(url: string) {
    this.url = normalizeGatewayUrl(url);
  }

  connect(): void {
    this.shouldReconnect = true;

    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING ||
      this.url === ''
    ) {
      return;
    }

    this.emitStatus({ attempt: this.reconnectAttempt + 1, type: 'connecting' });
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.flushQueue();
      this.emitStatus({ type: 'open' });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { payload: unknown; type: string };
        for (const handler of this.messageHandlers) {
          handler(msg);
        }
      } catch {
        return undefined;
      }
    };

    this.ws.onclose = (event) => {
      this.ws = null;
      this.emitStatus({
        reason: event.reason !== '' ? event.reason : `code ${event.code}`,
        type: 'closed',
      });

      if (!this.shouldReconnect) {
        return;
      }

      this.reconnectAttempt += 1;
      this.emitStatus({ delayMs: RECONNECT_DELAY_MS, type: 'reconnect-scheduled' });
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, RECONNECT_DELAY_MS);
    };

    this.ws.onerror = () => {
      this.emitStatus({ message: 'WebSocket transport error', type: 'error' });
    };
  }

  send(type: string, payload?: unknown): void {
    const frame = JSON.stringify({ type, payload });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
      return;
    }

    if (this.outboundQueue.length >= MAX_QUEUE_SIZE) {
      this.outboundQueue.shift();
    }
    this.outboundQueue.push(frame);
  }

  requestStatus(): void {
    this.send('get-status', {});
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.reconnectAttempt = 0;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }

    this.ws = null;
    this.outboundQueue = [];
    this.messageHandlers.clear();
    this.statusHandlers.clear();
  }

  private emitStatus(event: StatusEvent): void {
    for (const handler of this.statusHandlers) {
      handler(event);
    }
  }

  private flushQueue(): void {
    if (this.ws?.readyState !== WebSocket.OPEN || this.outboundQueue.length === 0) {
      return;
    }

    for (const frame of this.outboundQueue) {
      this.ws.send(frame);
    }
    this.outboundQueue = [];
  }
}
