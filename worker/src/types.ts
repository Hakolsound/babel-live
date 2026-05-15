/**
 * Worker-side type definitions.
 * Message shapes (BroadcasterUp, WorkerToBroadcaster, ViewerUp, WorkerToViewer)
 * must stay in sync with lib/worker-types.ts in the frontend.
 */

// ── Shared enums (mirrored in lib/worker-types.ts) ───────────────────────────

export type CaptionStability = 'partial' | 'stable' | 'final' | 'superseded' | 'corrected';
export type TranslationEngine = 'legacy_text' | 'realtime_translate' | 'realtime_stt_text';
export type ViewerMode = 'fast' | 'balanced' | 'accurate' | 'captions_only' | 'audio_only';
export type TranslationPromptProfile = 'fast_live' | 'balanced_live' | 'accurate_caption';

// ── Knowledge ────────────────────────────────────────────────────────────────

export interface EventKnowledge {
  domain: string;
  subdomain: string;
  specialty: string;
  briefing: string;
  keyterms: string[];
  termTranslations?: Record<string, Record<string, string>>;
}

// ── Broadcaster → Worker ──────────────────────────────────────────────────────

export type BroadcasterUp =
  | { type: 'hello'; eventId: string; sourceLang: string; targetLangs: string[]; knowledge?: EventKnowledge }
  | { type: 'audio'; pcm16: ArrayBuffer }
  | {
      type: 'transcript';
      utteranceId?: string;
      lang: string;
      text: string;
      final: boolean;
      stability?: 'partial' | 'stable' | 'final';
      ts: number;
      sentAt?: number;
    }
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
  | {
      type: 'transcript';
      lang: string;
      utteranceId?: string;
      text: string;
      final: boolean;
      ts: number;
      sentAt?: number;
    }
  | { type: 'listener_stats'; counts: Record<string, number> }
  | { type: 'handoff_requested'; broadcasterId: string; displayName?: string }
  | {
      type: 'translation_health';
      stats: {
        latencyByLang: Record<string, number>;
        audioPipelineByLang: Record<string, 'ok' | 'degraded' | 'offline'>;
        captionPipelineByLang: Record<string, 'ok' | 'degraded' | 'offline'>;
        viewerCountByLang: Record<string, number>;
        warnings: string[];
      };
    }
  | { type: 'error'; code: string; message: string };

// ── Viewer → Worker ───────────────────────────────────────────────────────────

export type ViewerUp =
  | { type: 'join'; eventCode: string; lang: string; mode?: ViewerMode }
  | { type: 'switch_lang'; lang: string; mode?: ViewerMode }
  | { type: 'leave' };

// ── Worker → Viewer ───────────────────────────────────────────────────────────

export type WorkerToViewer =
  | { type: 'joined'; lang: string; sampleRate: number }
  | {
      type: 'caption';
      lang: string;
      utteranceId: string;
      seq: number;
      text: string;
      stability: CaptionStability;
      source: TranslationEngine;
      ts: number;
      latencyMs?: number;
    }
  | { type: 'event_ended' }
  | { type: 'error'; code: string; message: string };

// ── Internal state ────────────────────────────────────────────────────────────

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
  /** Timestamp from the first transcript message that contributed to the current buffer */
  utteranceBufferSentAt: number | null;
  /** Timestamp from the first transcript message's sttFinalAt (if provided) */
  utteranceBufferSttFinalAt: number | null;
  /** Timer handle for the silence-gate flush */
  utteranceBufferTimer: ReturnType<typeof setTimeout> | null;
  /** Wall-clock time when the buffer first received content (for force-flush) */
  utteranceBufferStartedAt: number | null;

  /** Number of utterances flushed so far (triggers topic summary + ID generation) */
  utteranceCount: number;
  /** Running topic summary injected into translation prompts */
  topicSummary: string;
  /** Domain-specific glossary loaded from events.glossary */
  glossary: Record<string, string>;
  /** Event-specific knowledge base for enriched translation prompts */
  knowledge: EventKnowledge | null;

  /**
   * Monotonic counter per lang for in-flight translation streams.
   * Incremented on each new utterance. A callback that finds its seq no longer
   * matches state.finalSeq discards itself (stale stream guard).
   */
  finalSeq: Map<string, number>;

  /**
   * Last partial emitted per lang, including utteranceId and seq.
   * Used to send stability: 'superseded' when a new utterance displaces
   * an in-flight stream — prevents committing incomplete text as final.
   */
  lastPartialByLang: Map<string, { text: string; ts: number; utteranceId: string; seq: number }>;

  /** Active per-language TTS pipelines, keyed by ISO lang code */
  pipelines: Map<string, LanguagePipeline>;
  /** Viewer WebSockets, keyed by lang code */
  viewers: Map<string, Set<WebSocket>>;

  /**
   * Recent end-to-end latency (broadcasterSentAt → translationFinalAt) per lang.
   * Updated after each final translation; read by health reporting.
   */
  recentLatencyByLang: Map<string, number>;
}

export interface LanguagePipeline {
  lang: string;
  ttsWs: WebSocket | null;
  ttsReady: boolean;
  seqNum: number;           // 0–255 rolling, prefixed on every audio frame
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
  viewerMode: ViewerMode | null;
}
