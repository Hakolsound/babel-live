import type { ServerWebSocket } from 'bun';
import type {
  ClientMeta,
  BroadcasterUp,
  WorkerToBroadcaster,
  WorkerToViewer,
  EventState,
  EventKnowledge,
  CaptionStability,
  TranslationEngine,
} from '../types';
import { events, eventsByCode } from '../index';
import { supabase } from '../lib/supabase';
import { translateTextStreaming, generateTopicSummary } from '../lib/translate';
import { sendTextToTts, closeTtsPipeline, ensureTtsPipeline } from '../lib/tts-pipeline';
import {
  createTrace,
  forkTrace,
  markTrace,
  logTrace,
  persistTraceSummary,
} from '../lib/trace';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Rolling context window: prior source utterances passed to the translator */
const CONTEXT_SIZE = 6;

/** Prior translated utterances passed alongside source (per lang) */
const TRANSLATED_CONTEXT_SIZE = 4;

/** Regenerate rolling topic summary every N flushed utterances */
const SUMMARY_INTERVAL = 8;

/** Translation engine tag written into every caption message */
const ENGINE: TranslationEngine = 'legacy_text';

// ── Message handler ───────────────────────────────────────────────────────────

export async function handleBroadcasterMessage(
  ws: ServerWebSocket<ClientMeta>,
  msg: BroadcasterUp,
): Promise<void> {
  switch (msg.type) {
    case 'hello': {
      ws.data.eventId = msg.eventId;
      ws.data.role = 'broadcaster';

      const state: EventState = {
        eventId: msg.eventId,
        eventCode: null,
        sourceLang: msg.sourceLang,
        targetLangs: msg.targetLangs,
        startedAt: Date.now(),
        paused: false,
        pausedLangs: new Set(),
        broadcasterWs: ws as unknown as WebSocket,
        sourceHistory: [],
        translatedHistory: new Map(),
        utteranceBuffer: '',
        utteranceBufferSentAt: null,
        utteranceBufferSttFinalAt: null,
        utteranceBufferTimer: null,
        utteranceBufferStartedAt: null,
        utteranceCount: 0,
        topicSummary: '',
        glossary: {},
        knowledge: msg.knowledge ?? null,
        finalSeq: new Map(),
        lastPartialByLang: new Map(),
        pipelines: new Map(),
        viewers: new Map(),
        recentLatencyByLang: new Map(),
      };
      events.set(msg.eventId, state);

      lookupAndRegisterEvent(msg.eventId, state).catch((err: unknown) => {
        console.error(`[broadcaster] event lookup failed event=${msg.eventId}`, err);
      });

      ws.send(JSON.stringify({ type: 'ready' } satisfies WorkerToBroadcaster));
      console.log(
        `[broadcaster] hello event=${msg.eventId} source=${msg.sourceLang} targets=${msg.targetLangs.join(',')}`,
      );
      break;
    }

    case 'transcript': {
      const state = events.get(ws.data.eventId ?? '');
      if (!state || state.paused) return;
      if (!msg.text.trim()) return;

      // Only translate committed finals (GVC method)
      if (!msg.final) return;

      const msgSentAt = msg.sentAt;
      const msgSttFinalAt = msg.sentAt; // broadcaster sets sentAt ≈ sttFinalAt for now

      // Persist + fan out source captions immediately
      persistTranscript(state.eventId, msg.lang, msg.text, msg.ts).catch((err: unknown) => {
        console.error('[broadcaster] source transcript persist failed', err);
      });
      fanOutCaption(state, {
        lang: msg.lang,
        utteranceId: `src-${state.eventId.slice(0, 8)}-${state.utteranceCount + 1}`,
        seq: 0,
        text: msg.text,
        stability: 'final',
        source: ENGINE,
        ts: msg.ts,
      });

      if (state.targetLangs.length === 0) break;

      // Translate each committed chunk immediately — no buffering
      state.utteranceBuffer = msg.text;
      state.utteranceBufferSentAt = msgSentAt ?? null;
      state.utteranceBufferSttFinalAt = msgSttFinalAt ?? null;
      state.utteranceBufferStartedAt = Date.now();
      flushTranslationBuffer(state, msg.ts);
      break;
    }

    case 'update_targets': {
      const state = events.get(ws.data.eventId ?? '');
      if (!state) return;
      state.targetLangs = msg.targetLangs;
      console.log(
        `[broadcaster] update_targets event=${state.eventId} targets=${msg.targetLangs.join(',')}`,
      );
      break;
    }

    case 'pause_lang': {
      const state = events.get(ws.data.eventId ?? '');
      if (state) state.pausedLangs.add(msg.lang);
      break;
    }

    case 'resume_lang': {
      const state = events.get(ws.data.eventId ?? '');
      if (state) state.pausedLangs.delete(msg.lang);
      break;
    }

    case 'update_glossary': {
      const state = events.get(ws.data.eventId ?? '');
      if (state) {
        state.glossary = msg.glossary;
        console.log(
          `[broadcaster] update_glossary event=${state.eventId} terms=${Object.keys(msg.glossary).length}`,
        );
      }
      break;
    }

    case 'request_handoff': {
      const state = events.get(ws.data.eventId ?? '');
      if (!state) return;
      try {
        const handoffMsg: WorkerToBroadcaster = msg.displayName
          ? { type: 'handoff_requested', broadcasterId: msg.broadcasterId, displayName: msg.displayName }
          : { type: 'handoff_requested', broadcasterId: msg.broadcasterId };
        (state.broadcasterWs as unknown as ServerWebSocket<ClientMeta>)?.send(
          JSON.stringify(handoffMsg),
        );
      } catch { /* broadcaster gone */ }
      break;
    }

    case 'pause': {
      const state = events.get(ws.data.eventId ?? '');
      if (state) {
        if (state.utteranceBuffer.trim()) flushTranslationBuffer(state, Date.now());
        state.paused = true;
      }
      break;
    }

    case 'resume': {
      const state = events.get(ws.data.eventId ?? '');
      if (state) state.paused = false;
      break;
    }

    case 'end': {
      await teardownEvent(ws.data.eventId ?? '');
      break;
    }

    case 'audio': {
      // Unused in legacy_text mode — handled by realtime path in Phase 2
      break;
    }
  }
}

// ── Buffer flush ──────────────────────────────────────────────────────────────

function flushTranslationBuffer(state: EventState, ts: number): void {
  const text = state.utteranceBuffer.trim();
  state.utteranceBuffer = '';

  const broadcasterSentAt = state.utteranceBufferSentAt ?? undefined;
  const sttFinalAt = state.utteranceBufferSttFinalAt ?? undefined;
  state.utteranceBufferSentAt = null;
  state.utteranceBufferSttFinalAt = null;
  state.utteranceBufferStartedAt = null;

  if (!text) return;

  // Snapshot context before pushing the new utterance
  const priorSource = state.sourceHistory.slice(-CONTEXT_SIZE);
  const priorTranslated = new Map(
    [...state.targetLangs].map(lang => [
      lang,
      (state.translatedHistory.get(lang) ?? []).slice(-TRANSLATED_CONTEXT_SIZE),
    ]),
  );

  state.sourceHistory.push(text);
  if (state.sourceHistory.length > CONTEXT_SIZE + 2) state.sourceHistory.shift();

  state.utteranceCount++;

  // Stable utterance ID: deterministic, traceable, per-event
  const utteranceId = `${state.eventId.slice(0, 8)}-u${state.utteranceCount}`;

  // Base trace covers worker-level timing; per-lang forks cover translation timing
  const baseTrace = createTrace(state.eventId, utteranceId, {
    ...(broadcasterSentAt !== undefined ? { broadcasterSentAt } : {}),
    ...(sttFinalAt !== undefined ? { sttFinalAt } : {}),
  });
  markTrace(baseTrace, 'bufferFlushAt');

  translateAllTargets(state, text, utteranceId, priorSource, priorTranslated, ts, baseTrace);

  // Async topic summary — never blocks translation
  if (state.utteranceCount % SUMMARY_INTERVAL === 0) {
    const recentUtterances = state.sourceHistory.slice(-SUMMARY_INTERVAL);
    generateTopicSummary(recentUtterances, state.topicSummary)
      .then(summary => { state.topicSummary = summary; })
      .catch((err: unknown) => console.error('[broadcaster] topic summary failed', err));
  }
}

// ── Translation fan-out ───────────────────────────────────────────────────────

function translateAllTargets(
  state: EventState,
  text: string,
  utteranceId: string,
  priorSource: string[],
  priorTranslated: Map<string, string[]>,
  ts: number,
  baseTrace: ReturnType<typeof createTrace>,
): void {
  for (const targetLang of state.targetLangs) {
    if (state.pausedLangs.has(targetLang)) continue;

    const translatedContext = priorTranslated.get(targetLang) ?? [];

    // Displace any in-flight partial for this lang with stability: 'superseded'.
    // This MUST NOT be persisted — it is semantically incomplete.
    const displaced = state.lastPartialByLang.get(targetLang);
    if (displaced) {
      fanOutCaption(state, {
        lang: targetLang,
        utteranceId: displaced.utteranceId,
        seq: displaced.seq + 1,
        text: displaced.text,
        stability: 'superseded',
        source: ENGINE,
        ts: displaced.ts,
      });
      state.lastPartialByLang.delete(targetLang);
      // Do NOT persist — stability:superseded is never written to transcript_entries
    }

    // Monotonic stale-stream guard: callbacks check this before emitting
    const streamSeq = (state.finalSeq.get(targetLang) ?? 0) + 1;
    state.finalSeq.set(targetLang, streamSeq);

    // Per-language trace fork
    const trace = forkTrace(baseTrace, targetLang);
    markTrace(trace, 'translationRequestAt');

    // Incrementing seq within this utterance + lang
    let partialSeq = 0;

    translateTextStreaming({
      text,
      sourceLang: state.sourceLang === 'auto' ? 'auto-detected' : state.sourceLang,
      targetLang,
      priorContext: priorSource,
      translatedContext,
      glossary: state.glossary,
      knowledge: state.knowledge,
      ...(state.topicSummary ? { topicSummary: state.topicSummary } : {}),
      onFirstToken: () => { markTrace(trace, 'translationFirstTokenAt'); },
      onPartial: (accumulated) => {
        // Discard if a newer utterance has already claimed this lang
        if (state.finalSeq.get(targetLang) !== streamSeq) return;
        const seq = partialSeq++;
        state.lastPartialByLang.set(targetLang, {
          text: accumulated,
          ts,
          utteranceId,
          seq,
        });
        fanOutCaption(state, {
          lang: targetLang,
          utteranceId,
          seq,
          text: accumulated,
          stability: 'partial',
          source: ENGINE,
          ts,
        });
      },
    })
      .then(({ translated, firstTokenMs }) => {
        if (!translated) return;

        // Stale stream: a newer utterance claimed this lang while we were streaming
        if (state.finalSeq.get(targetLang) !== streamSeq) return;

        markTrace(trace, 'translationFinalAt');
        state.lastPartialByLang.delete(targetLang);

        // Persist translated history for context in future calls
        const history = state.translatedHistory.get(targetLang) ?? [];
        history.push(translated);
        if (history.length > CONTEXT_SIZE + 2) history.shift();
        state.translatedHistory.set(targetLang, history);

        // Compute end-to-end latency for this final
        const latencyMs = baseTrace.broadcasterSentAt
          ? Date.now() - baseTrace.broadcasterSentAt
          : undefined;

        // Update running latency for health reporting
        if (latencyMs !== undefined) state.recentLatencyByLang.set(targetLang, latencyMs);

        // Persist to Supabase — only final translations, never partials or superseded
        persistTranscript(state.eventId, targetLang, translated, ts).catch((err: unknown) => {
          console.error(`[translation] persist failed lang=${targetLang}`, err);
        });

        // Fan out the final caption
        fanOutCaption(state, {
          lang: targetLang,
          utteranceId,
          seq: partialSeq,
          text: translated,
          stability: 'final',
          source: ENGINE,
          ts,
          ...(latencyMs !== undefined ? { latencyMs } : {}),
        });

        // Echo back to broadcaster UI
        try {
          const echoMsg: WorkerToBroadcaster = {
            type: 'transcript',
            lang: targetLang,
            utteranceId,
            text: translated,
            final: true,
            ts,
            ...(baseTrace.broadcasterSentAt ? { sentAt: baseTrace.broadcasterSentAt } : {}),
          };
          (state.broadcasterWs as unknown as ServerWebSocket<ClientMeta>)?.send(
            JSON.stringify(echoMsg),
          );
        } catch { /* broadcaster gone */ }

        // Start or feed TTS only on final, quality-assured text
        const viewerCount = state.viewers.get(targetLang)?.size ?? 0;
        if (viewerCount > 0 && !state.pipelines.has(targetLang)) {
          ensureTtsPipeline(state, targetLang, viewerCount);
        }
        const pipeline = state.pipelines.get(targetLang);
        if (pipeline) sendTextToTts(pipeline, translated);

        // Trace logging + async persistence
        logTrace(trace);
        persistTraceSummary(trace, ENGINE);

        console.log(
          `[translation] event=${state.eventId} lang=${targetLang} ` +
          `tt1=${firstTokenMs ?? 'n/a'}ms e2e=${latencyMs ?? 'n/a'}ms ` +
          `"${translated.slice(0, 60)}"`,
        );
      })
      .catch((err: unknown) => {
        console.error(`[translation] failed lang=${targetLang}`, err);
      });
  }
}

// ── Caption fan-out ───────────────────────────────────────────────────────────

interface CaptionMsg {
  lang: string;
  utteranceId: string;
  seq: number;
  text: string;
  stability: CaptionStability;
  source: TranslationEngine;
  ts: number;
  latencyMs?: number;
}

function fanOutCaption(state: EventState, msg: CaptionMsg): void {
  const viewerSet = state.viewers.get(msg.lang);
  if (!viewerSet || viewerSet.size === 0) return;

  const payload = JSON.stringify({
    type: 'caption',
    lang: msg.lang,
    utteranceId: msg.utteranceId,
    seq: msg.seq,
    text: msg.text,
    stability: msg.stability,
    source: msg.source,
    ts: msg.ts,
    ...(msg.latencyMs !== undefined ? { latencyMs: msg.latencyMs } : {}),
  } satisfies WorkerToViewer);

  for (const viewer of viewerSet) {
    try {
      (viewer as unknown as ServerWebSocket<ClientMeta>).send(payload);
    } catch { /* viewer gone */ }
  }
}

// ── Event registration ────────────────────────────────────────────────────────

async function lookupAndRegisterEvent(eventId: string, state: EventState): Promise<void> {
  const { data, error } = await supabase
    .from('events')
    .select(
      'event_code, glossary, knowledge_domain, knowledge_subdomain, knowledge_specialty, ' +
      'knowledge_briefing, knowledge_keyterms, knowledge_term_translations',
    )
    .eq('id', eventId)
    .single();

  if (error || !data) {
    console.error(`[broadcaster] could not find event=${eventId}`, error);
    return;
  }

  const row = data as unknown as Record<string, unknown>;

  if (row['event_code']) {
    state.eventCode = row['event_code'] as string;
    eventsByCode.set(row['event_code'] as string, eventId);
  }

  if (row['glossary'] && typeof row['glossary'] === 'object') {
    state.glossary = row['glossary'] as Record<string, string>;
  }

  const dbKnowledge = buildKnowledgeFromDb(row);
  if (dbKnowledge) state.knowledge = dbKnowledge;

  const region = process.env.FLY_REGION ?? 'dev';
  await supabase.from('events').update({ fly_region: region }).eq('id', eventId);

  console.log(
    `[broadcaster] registered event=${eventId} code=${state.eventCode} ` +
    `region=${region} knowledge=${!!state.knowledge}`,
  );
}

function buildKnowledgeFromDb(data: Record<string, unknown>): EventKnowledge | null {
  const domain       = (data.knowledge_domain       as string | null) ?? '';
  const subdomain    = (data.knowledge_subdomain     as string | null) ?? '';
  const specialty    = (data.knowledge_specialty     as string | null) ?? '';
  const briefing     = (data.knowledge_briefing      as string | null) ?? '';
  const keyterms     = (data.knowledge_keyterms      as string[] | null) ?? [];
  const termTrans    = (data.knowledge_term_translations as Record<string, Record<string, string>> | null) ?? {};

  if (!domain && !briefing && keyterms.length === 0) return null;
  return {
    domain,
    subdomain,
    specialty,
    briefing,
    keyterms,
    ...(Object.keys(termTrans).length > 0 ? { termTranslations: termTrans } : {}),
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Only called for stability: 'final' translations and source transcripts.
 * Partials, superseded, and interrupted fragments are NEVER written here.
 */
async function persistTranscript(
  eventId: string,
  languageCode: string,
  text: string,
  timestampMs: number,
): Promise<void> {
  const { error } = await supabase.from('transcript_entries').insert({
    event_id: eventId,
    language_code: languageCode,
    text,
    timestamp_ms: timestampMs,
    is_final: true,
  });
  if (error) console.error('[broadcaster] transcript_entries insert failed', error.message);
}

// ── Teardown ──────────────────────────────────────────────────────────────────

export async function teardownEvent(eventId: string): Promise<void> {
  const state = events.get(eventId);
  if (!state) return;

  if (state.utteranceBufferTimer) {
    clearTimeout(state.utteranceBufferTimer);
    state.utteranceBufferTimer = null;
  }
  if (state.utteranceBuffer.trim()) flushTranslationBuffer(state, Date.now());

  // Notify all viewers
  for (const [, viewerSet] of state.viewers) {
    for (const viewer of viewerSet) {
      try {
        (viewer as unknown as ServerWebSocket<ClientMeta>).send(
          JSON.stringify({ type: 'event_ended' } satisfies WorkerToViewer),
        );
      } catch { /* gone */ }
    }
  }

  // Close all TTS pipelines
  for (const [, pipeline] of state.pipelines) {
    closeTtsPipeline(pipeline);
  }

  if (state.eventCode) eventsByCode.delete(state.eventCode);
  events.delete(eventId);
  console.log(`[broadcaster] torn down event=${eventId}`);
}
