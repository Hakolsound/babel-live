/**
 * Utterance-level latency tracing for the Babel translation pipeline.
 *
 * Each source utterance gets a trace object. Stages are stamped as they complete.
 * Summaries are persisted async to translation_latency_events — never blocking
 * the hot translation path.
 */

import { supabase } from './supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UtteranceTrace {
  eventId: string;
  utteranceId: string;
  lang?: string;

  // Broadcaster-side timestamps (sent in the transcript message)
  sttFinalAt?: number;
  broadcasterSentAt?: number;

  // Worker-side timestamps
  workerReceivedAt?: number;
  bufferFlushAt?: number;

  // Per-language translation timestamps (set when a translation starts for one lang)
  translationRequestAt?: number;
  translationFirstTokenAt?: number;
  translationFinalAt?: number;

  // TTS timestamps
  ttsRequestAt?: number;
  ttsFirstByteAt?: number;
  ttsFinalByteAt?: number;
}

export interface LatencySummary {
  networkLatencyMs?: number;          // workerReceivedAt - broadcasterSentAt
  bufferLatencyMs?: number;           // bufferFlushAt - workerReceivedAt
  translationFirstTokenMs?: number;   // translationFirstTokenAt - translationRequestAt
  translationTotalMs?: number;        // translationFinalAt - translationRequestAt
  ttsFirstByteMs?: number;            // ttsFirstByteAt - ttsRequestAt
  endToEndTextMs?: number;            // translationFinalAt - broadcasterSentAt
  endToEndTextFromSttMs?: number;     // translationFinalAt - sttFinalAt
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createTrace(
  eventId: string,
  utteranceId: string,
  options?: { lang?: string; broadcasterSentAt?: number; sttFinalAt?: number },
): UtteranceTrace {
  return {
    eventId,
    utteranceId,
    workerReceivedAt: Date.now(),
    ...(options?.lang !== undefined ? { lang: options.lang } : {}),
    ...(options?.broadcasterSentAt !== undefined ? { broadcasterSentAt: options.broadcasterSentAt } : {}),
    ...(options?.sttFinalAt !== undefined ? { sttFinalAt: options.sttFinalAt } : {}),
  };
}

/**
 * Clone a base trace to create a per-language copy.
 * The base trace covers worker-level stages; the clone tracks translation + TTS
 * for a specific target language.
 */
export function forkTrace(base: UtteranceTrace, lang: string): UtteranceTrace {
  return { ...base, lang };
}

// ── Mutation ─────────────────────────────────────────────────────────────────

export function markTrace(
  trace: UtteranceTrace,
  stage: keyof Omit<UtteranceTrace, 'eventId' | 'utteranceId' | 'lang'>,
  value = Date.now(),
): void {
  (trace as unknown as Record<string, unknown>)[stage] = value;
}

// ── Analysis ─────────────────────────────────────────────────────────────────

export function getLatencySummary(trace: UtteranceTrace): LatencySummary {
  const summary: LatencySummary = {};

  if (trace.broadcasterSentAt && trace.workerReceivedAt) {
    summary.networkLatencyMs = trace.workerReceivedAt - trace.broadcasterSentAt;
  }
  if (trace.workerReceivedAt && trace.bufferFlushAt) {
    summary.bufferLatencyMs = trace.bufferFlushAt - trace.workerReceivedAt;
  }
  if (trace.translationRequestAt && trace.translationFirstTokenAt) {
    summary.translationFirstTokenMs = trace.translationFirstTokenAt - trace.translationRequestAt;
  }
  if (trace.translationRequestAt && trace.translationFinalAt) {
    summary.translationTotalMs = trace.translationFinalAt - trace.translationRequestAt;
  }
  if (trace.ttsRequestAt && trace.ttsFirstByteAt) {
    summary.ttsFirstByteMs = trace.ttsFirstByteAt - trace.ttsRequestAt;
  }
  if (trace.broadcasterSentAt && trace.translationFinalAt) {
    summary.endToEndTextMs = trace.translationFinalAt - trace.broadcasterSentAt;
  }
  if (trace.sttFinalAt && trace.translationFinalAt) {
    summary.endToEndTextFromSttMs = trace.translationFinalAt - trace.sttFinalAt;
  }

  return summary;
}

export function logTrace(trace: UtteranceTrace): void {
  if (!trace.lang) return;
  const s = getLatencySummary(trace);
  const parts: string[] = [`[trace] ${trace.utteranceId} lang=${trace.lang}`];
  if (s.networkLatencyMs !== undefined)        parts.push(`net=${s.networkLatencyMs}ms`);
  if (s.bufferLatencyMs !== undefined)         parts.push(`buf=${s.bufferLatencyMs}ms`);
  if (s.translationFirstTokenMs !== undefined) parts.push(`tt1=${s.translationFirstTokenMs}ms`);
  if (s.translationTotalMs !== undefined)      parts.push(`ttl=${s.translationTotalMs}ms`);
  if (s.ttsFirstByteMs !== undefined)          parts.push(`tts=${s.ttsFirstByteMs}ms`);
  if (s.endToEndTextMs !== undefined)          parts.push(`e2e=${s.endToEndTextMs}ms`);
  console.log(parts.join(' '));
}

// ── Persistence ───────────────────────────────────────────────────────────────

const TRACE_ENABLED = process.env.LATENCY_TRACE_ENABLED === 'true';
const TRACE_SAMPLE_RATE = parseFloat(process.env.LATENCY_TRACE_SAMPLE_RATE ?? '1.0');

/**
 * Persist a latency summary to Supabase async — fire-and-forget.
 * Respects LATENCY_TRACE_ENABLED and LATENCY_TRACE_SAMPLE_RATE env vars.
 */
export function persistTraceSummary(trace: UtteranceTrace, engine: string): void {
  if (!TRACE_ENABLED) return;
  if (Math.random() > TRACE_SAMPLE_RATE) return;
  if (!trace.lang) return;

  const summary = getLatencySummary(trace);
  if (Object.keys(summary).length === 0) return;

  supabase
    .from('translation_latency_events')
    .insert({
      event_id: trace.eventId,
      utterance_id: trace.utteranceId,
      language_code: trace.lang,
      engine,
      stage: 'summary',
      timestamp_ms: Date.now(),
      metadata: summary,
    })
    .then(({ error }) => {
      if (error) console.error('[trace] persist failed', error.message);
    });
}
