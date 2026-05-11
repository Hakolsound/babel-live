import type { BroadcasterUp, WorkerToBroadcaster } from '@/lib/worker-types';

export type WorkerClientHandlers = {
  onReady: () => void;
  onTranscript: (lang: string, text: string, final: boolean, ts: number) => void;
  onListenerStats: (counts: Record<string, number>) => void;
  onError: (code: string, message: string) => void;
  onDisconnected: () => void;
};

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

export class WorkerClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: WorkerClientHandlers;
  private pendingHello: Extract<BroadcasterUp, { type: 'hello' }> | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;

  constructor(handlers: WorkerClientHandlers) {
    const base = process.env.NEXT_PUBLIC_WORKER_URL ?? 'ws://localhost:3002';
    this.url = `${base}/ws`;
    this.handlers = handlers;
  }

  connect(eventId: string, sourceLang: string, targetLangs: string[]): void {
    this.pendingHello = { type: 'hello', eventId, sourceLang, targetLangs };
    this.destroyed = false;
    this.openSocket();
  }

  private openSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }

    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      if (this.pendingHello) {
        this.send(this.pendingHello);
      }
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return;
      let msg: WorkerToBroadcaster;
      try {
        msg = JSON.parse(evt.data) as WorkerToBroadcaster;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'ready':
          this.handlers.onReady();
          break;
        case 'transcript':
          this.handlers.onTranscript(msg.lang, msg.text, msg.final, msg.ts);
          break;
        case 'listener_stats':
          this.handlers.onListenerStats(msg.counts);
          break;
        case 'error':
          this.handlers.onError(msg.code, msg.message);
          break;
      }
    };

    ws.onclose = () => {
      if (this.destroyed) return;
      this.handlers.onDisconnected();
      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        setTimeout(() => {
          if (!this.destroyed) this.openSocket();
        }, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror, reconnect handled there
    };
  }

  sendTranscript(lang: string, text: string, final: boolean, ts: number): void {
    this.send({ type: 'transcript', lang, text, final, ts } as BroadcasterUp);
  }

  updateTargets(targetLangs: string[]): void {
    this.send({ type: 'update_targets', targetLangs });
  }

  end(): void {
    this.send({ type: 'end' });
    this.destroy();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private send(msg: BroadcasterUp): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
