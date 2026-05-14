import type { ViewerUp, WorkerToViewer } from './worker-types';

export interface ViewerClientHandlers {
  onJoined: (lang: string, sampleRate: number) => void;
  onCaption: (text: string, ts: number, final: boolean) => void;
  onAudioFrame: (frame: ArrayBuffer) => void;
  onEventEnded: () => void;
  onError: (code: string, message: string) => void;
  onDisconnected: () => void;
}

const MAX_RECONNECT = 5;
const RECONNECT_DELAY_MS = 2000;

export class ViewerClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  private pendingJoin: { eventCode: string; lang: string } | null = null;

  constructor(
    private readonly workerUrl: string,
    private readonly handlers: ViewerClientHandlers,
  ) {}

  join(eventCode: string, lang: string): void {
    this.pendingJoin = { eventCode, lang };
    this.connect();
  }

  switchLang(lang: string): void {
    this.sendJson({ type: 'switch_lang', lang } satisfies ViewerUp);
  }

  leave(): void {
    this.sendJson({ type: 'leave' } satisfies ViewerUp);
    this.destroyed = true;
    this.ws?.close();
    this.ws = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.destroyed) return;

    const url = `${this.workerUrl}/ws`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      if (this.pendingJoin) {
        this.sendJson({ type: 'join', ...this.pendingJoin } satisfies ViewerUp);
      }
    };

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        this.handlers.onAudioFrame(evt.data);
        return;
      }
      if (typeof evt.data !== 'string') return;

      let msg: WorkerToViewer;
      try { msg = JSON.parse(evt.data) as WorkerToViewer; } catch { return; }

      switch (msg.type) {
        case 'joined':
          this.handlers.onJoined(msg.lang, msg.sampleRate);
          break;
        case 'caption':
          this.handlers.onCaption(msg.text, msg.ts, msg.final);
          break;
        case 'event_ended':
          this.handlers.onEventEnded();
          break;
        case 'error':
          this.handlers.onError(msg.code, msg.message);
          // Don't auto-reconnect for business-logic errors — caller decides
          if (msg.code === 'EVENT_NOT_FOUND' || msg.code === 'UNAUTHORIZED') {
            this.destroyed = true;
          }
          break;
      }
    };

    ws.onclose = () => {
      if (this.destroyed) return;
      this.handlers.onDisconnected();
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires right after, handles reconnect
    };
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectAttempts >= MAX_RECONNECT) return;
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }

  private sendJson(msg: ViewerUp): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
