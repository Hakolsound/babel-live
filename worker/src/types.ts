// ── Broadcaster → Worker ──────────────────────────────────────────────────────

export type BroadcasterUp =
  | { type: 'hello'; eventId: string; sourceLang: string; targetLangs: string[] }
  | { type: 'audio'; pcm16: ArrayBuffer }  // 16kHz mono PCM, 20ms frames (unused in Option B — Scribe is browser-direct)
  | { type: 'update_targets'; targetLangs: string[] }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'end' };

// ── Worker → Broadcaster ──────────────────────────────────────────────────────

export type WorkerToBroadcaster =
  | { type: 'ready' }
  | { type: 'transcript'; lang: 'source' | string; text: string; final: boolean; ts: number }
  | { type: 'listener_stats'; counts: Record<string, number> }
  | { type: 'error'; code: string; message: string };

// ── Viewer → Worker ───────────────────────────────────────────────────────────

export type ViewerUp =
  | { type: 'join'; eventCode: string; lang: string }
  | { type: 'switch_lang'; lang: string }
  | { type: 'leave' };

// ── Worker → Viewer ───────────────────────────────────────────────────────────
// Control frames: JSON. Audio frames: binary (raw Opus, 1-byte seq prefix)

export type WorkerToViewer =
  | { type: 'joined'; lang: string; sampleRate: number }
  | { type: 'caption'; text: string; ts: number; final: boolean }
  | { type: 'speaking_started' }
  | { type: 'speaking_ended' }
  | { type: 'event_ended' }
  | { type: 'error'; code: string; message: string };

// ── Internal state types ──────────────────────────────────────────────────────

export interface EventState {
  eventId: string;
  sourceLang: string;
  targetLangs: string[];
  startedAt: number;
  paused: boolean;
  broadcasterWs: WebSocket | null;
  /** Active per-language pipelines, keyed by ISO lang code */
  pipelines: Map<string, LanguagePipeline>;
  /** Viewer WebSockets, keyed by lang code */
  viewers: Map<string, Set<WebSocket>>;
}

export interface LanguagePipeline {
  lang: string;
  translationActive: boolean;
  ttsWs: WebSocket | null;
  teardownTimer: ReturnType<typeof setTimeout> | null;
  peakListeners: number;
  totalAudioMs: number;
  sessionId: string | null;
}

export type ClientRole = 'broadcaster' | 'viewer';

export interface ClientMeta {
  role: ClientRole | null;
  eventId: string | null;
  lang: string | null;
}
