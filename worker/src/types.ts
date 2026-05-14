// ── Broadcaster → Worker ──────────────────────────────────────────────────────

export interface EventKnowledge {
  domain: string;
  subdomain: string;
  specialty: string;
  briefing: string;
  keyterms: string[];
  termTranslations?: Record<string, Record<string, string>>;
}

export type BroadcasterUp =
  | { type: 'hello'; eventId: string; sourceLang: string; targetLangs: string[]; knowledge?: EventKnowledge }
  | { type: 'audio'; pcm16: ArrayBuffer }  // 16kHz mono PCM (unused in Option B — Scribe is browser-direct)
  | { type: 'transcript'; lang: string; text: string; final: boolean; ts: number; sentAt?: number }
  | { type: 'update_targets'; targetLangs: string[] }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'pause_lang'; lang: string }
  | { type: 'resume_lang'; lang: string }
  | { type: 'update_glossary'; glossary: Record<string, string> }
  | { type: 'request_handoff'; broadcasterId: string; displayName?: string }
  | { type: 'end' };

// ── Worker → Broadcaster ──────────────────────────────────────────────────────

export type WorkerToBroadcaster =
  | { type: 'ready' }
  | { type: 'transcript'; lang: 'source' | string; text: string; final: boolean; ts: number; sentAt?: number }
  | { type: 'listener_stats'; counts: Record<string, number> }
  | { type: 'handoff_requested'; broadcasterId: string; displayName?: string }
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
  eventCode: string | null;
  sourceLang: string;
  targetLangs: string[];
  startedAt: number;
  paused: boolean;
  pausedLangs: Set<string>;
  broadcasterWs: WebSocket | null;
  /** Rolling window of finalized source utterances (for translation context) */
  sourceHistory: string[];
  /** Rolling window of translated utterances per target lang (for translation continuity) */
  translatedHistory: Map<string, string[]>;
  /** Accumulated STT finals waiting for buffer flush */
  utteranceBuffer: string;
  /** Timer for flushing the utterance buffer */
  utteranceBufferTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp when the buffer first received content — used to enforce max buffer age */
  utteranceBufferStartedAt: number | null;
  /** Number of utterances flushed so far (triggers topic summary updates) */
  utteranceCount: number;
  /** Running topic summary injected into translation prompts */
  topicSummary: string;
  /** Domain-specific glossary terms loaded from events.glossary */
  glossary: Record<string, string>;
  /** Event-specific knowledge base for enriched translation prompts */
  knowledge: EventKnowledge | null;
  /** Monotonic counter per lang for final translations — newer stream discards older in-flight partials */
  finalSeq: Map<string, number>;
  /** Last partial emitted per lang — committed as final=true if the translation is displaced before completing */
  lastPartialByLang: Map<string, { text: string; ts: number }>;
  /** Active per-language pipelines, keyed by ISO lang code */
  pipelines: Map<string, LanguagePipeline>;
  /** Viewer WebSockets, keyed by lang code */
  viewers: Map<string, Set<WebSocket>>;
}

export interface LanguagePipeline {
  lang: string;
  ttsWs: WebSocket | null;
  ttsReady: boolean;
  seqNum: number;           // 0-255 rolling, prefixed on every audio frame
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
