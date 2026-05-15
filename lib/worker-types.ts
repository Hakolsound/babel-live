/**
 * Shared WebSocket message contracts — duplicated here so the frontend
 * doesn't need to reach into the worker's bun-typed source tree.
 * Keep in sync with worker/src/types.ts
 */

// ── Domain types ──────────────────────────────────────────────────────────────

export interface EventKnowledge {
  domain: string;
  subdomain: string;
  specialty: string;
  briefing: string;
  keyterms: string[];
  /** { [term]: { [langCode]: overrideTranslation } } — empty means keep-as-is */
  termTranslations?: Record<string, Record<string, string>>;
}

/**
 * Lifecycle of a single translated utterance visible to the viewer.
 *
 * partial    — in-flight streaming token; replace previous partial for same utteranceId
 * stable     — still streaming but enough tokens to render confidently
 * final      — translation complete; commit to transcript, persist to DB
 * superseded — a new utterance started before this one finished; discard, do not persist
 * corrected  — post-event or async correction of an already-committed entry
 */
export type CaptionStability = 'partial' | 'stable' | 'final' | 'superseded' | 'corrected';

/** Which engine produced this caption. Extensible for Phase 2. */
export type TranslationEngine = 'legacy_text' | 'realtime_translate' | 'realtime_stt_text';

/**
 * Viewer quality/behaviour preference.
 *
 * fast          — render partials immediately; caption may self-correct
 * balanced      — default; small buffer for smoother output
 * accurate      — intentional 1.5–3 s delay; fewer rewrites
 * captions_only — no audio decode path initialised
 * audio_only    — minimal caption UI; audio is primary
 */
export type ViewerMode = 'fast' | 'balanced' | 'accurate' | 'captions_only' | 'audio_only';

/** Translation prompt quality profile. */
export type TranslationPromptProfile = 'fast_live' | 'balanced_live' | 'accurate_caption';

// ── Broadcaster → Worker ──────────────────────────────────────────────────────

export type BroadcasterUp =
  | { type: 'hello'; eventId: string; sourceLang: string; targetLangs: string[]; knowledge?: EventKnowledge }
  | { type: 'audio'; pcm16: ArrayBuffer }
  | {
      type: 'transcript';
      /** Stable ID for this source utterance — correlates source + all translations */
      utteranceId?: string;
      lang: string;
      text: string;
      final: boolean;
      /** STT-level stability before the worker receives it */
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
// Control frames: JSON. Audio frames: binary ([seqByte][opusData]).

export type WorkerToViewer =
  | { type: 'joined'; lang: string; sampleRate: number }
  | {
      type: 'caption';
      /** ISO-639-1 target language */
      lang: string;
      /** Stable ID for the source utterance — used to replace partials in-place */
      utteranceId: string;
      /** Monotonically increasing within one utteranceId; viewer uses for ordering */
      seq: number;
      text: string;
      stability: CaptionStability;
      source: TranslationEngine;
      ts: number;
      /** Wall-clock ms from broadcasterSentAt to translationFinalAt, only on final */
      latencyMs?: number;
    }
  | { type: 'event_ended' }
  | { type: 'error'; code: string; message: string };
