type MessageHandler = (msg: { type: string; payload: unknown }) => void;

const RECONNECT_DELAY_MS = 3000;

export class LiveGatewayClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      return undefined;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { payload: unknown; type: string };
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch {
        return undefined;
      }
    };

    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, RECONNECT_DELAY_MS);
    };

    this.ws.onerror = () => {
      return undefined;
    };
  }

  send(type: string, payload?: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ type, payload }));
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
    this.handlers = [];
  }
}
