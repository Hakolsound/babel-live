import type { ViewerUp, WorkerToViewer, CaptionStability, TranslationEngine, ViewerMode } from './worker-types';
import { checkAudioSupport, type AudioSupportResult } from './audio-player';

export type { CaptionStability, TranslationEngine, ViewerMode };

export interface CaptionEvent {
  lang: string;
  utteranceId: string;
  seq: number;
  text: string;
  stability: CaptionStability;
  source: TranslationEngine;
  ts: number;
  latencyMs?: number;
}

export interface TranslationHealthStats {
  latencyByLang: Record<string, number>;
  audioPipelineByLang: Record<string, 'ok' | 'degraded' | 'offline'>;
  captionPipelineByLang: Record<string, 'ok' | 'degraded' | 'offline'>;
  viewerCountByLang: Record<string, number>;
  warnings: string[];
}

export interface ViewerClientHandlers {
  onJoined: (lang: string, sampleRate: number) => void;
  onCaption: (caption: CaptionEvent) => void;
  onAudioFrame: (frame: ArrayBuffer) => void;
  onEventEnded: () => void;
  onError: (code: string, message: string) => void;
  onDisconnected: () => void;
  onReconnecting?: (attempt: number) => void;
  onTranslationHealth?: (stats: TranslationHealthStats) => void;
}

const MAX_RECONNECT = 5;
const RECONNECT_DELAY_MS = 2000;

export class ViewerClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  private pendingJoin: { eventCode: string; lang: string; mode: ViewerMode } | null = null;
  private currentLang: string | null = null;
  private currentMode: ViewerMode = 'balanced';

  readonly audioSupport: AudioSupportResult = checkAudioSupport();

  constructor(
    private readonly workerUrl: string,
    private readonly handlers: ViewerClientHandlers,
  ) {}

  join(eventCode: string, lang: string, mode: ViewerMode = 'balanced'): void {
    this.pendingJoin = { eventCode, lang, mode };
    this.currentLang = lang;
    this.currentMode = mode;
    this.connect();
  }

  switchLang(lang: string, mode?: ViewerMode): void {
    this.currentLang = lang;
    if (mode !== undefined) this.currentMode = mode;
    this.sendJson({ type: 'switch_lang', lang, mode: this.currentMode } satisfies ViewerUp);
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

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
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
          this.handlers.onCaption({
            lang: msg.lang,
            utteranceId: msg.utteranceId,
            seq: msg.seq,
            text: msg.text,
            stability: msg.stability,
            source: msg.source,
            ts: msg.ts,
            latencyMs: msg.latencyMs,
          });
          break;

        case 'event_ended':
          this.handlers.onEventEnded();
          break;

        case 'error':
          this.handlers.onError(msg.code, msg.message);
          if (msg.code === 'EVENT_NOT_FOUND' || msg.code === 'UNAUTHORIZED') {
            this.destroyed = true;
          }
          break;

        // translation_health is only sent to broadcasters, but handle gracefully
        default:
          // Check for translation_health on the raw parsed object since WorkerToViewer
          // union doesn't include it (it's WorkerToBroadcaster). Cast to access it.
          {
            const raw = msg as Record<string, unknown>;
            if (raw['type'] === 'translation_health' && this.handlers.onTranslationHealth) {
              this.handlers.onTranslationHealth(
                raw['stats'] as TranslationHealthStats,
              );
            }
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
    this.handlers.onReconnecting?.(this.reconnectAttempts);
    setTimeout(() => this.connect(), RECONNECT_DELAY_MS * this.reconnectAttempts);
  }

  private sendJson(msg: ViewerUp): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
