import type { ServerWebSocket } from 'bun';
import type { ClientMeta, BroadcasterUp, WorkerToBroadcaster, EventState, EventKnowledge } from '../types';
import { events, eventsByCode } from '../index';
import { supabase } from '../lib/supabase';
import { translateTextStreaming, generateTopicSummary } from '../lib/translate';
import { sendTextToTts, closeTtsPipeline, ensureTtsPipeline } from '../lib/tts-pipeline';

/** Rolling context window: number of prior source utterances passed to the translator */
const CONTEXT_SIZE = 6;

/** Translated context window: prior translated utterances passed alongside source (per lang) */
const TRANSLATED_CONTEXT_SIZE = 4;

/** Wait this long after the last transcript before flushing (trailing silence gate) */
const BUFFER_MS = 300;

/** Force-flush if the buffer has been accumulating for this long, even with continuous speech */
const MAX_BUFFER_MS = 3500;

/** Flush immediately when an utterance ends with sentence-ending punctuation */
const SENTENCE_END_RE = /[.!?]["']?\s*$/;

/** Update the rolling topic summary every N flushed utterances */
const SUMMARY_INTERVAL = 8;

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
      };
      events.set(msg.eventId, state);

      lookupAndRegisterEvent(msg.eventId, state).catch((err: unknown) => {
        console.error(`[broadcaster] event lookup failed event=${msg.eventId}`, err);
      });

      ws.send(JSON.stringify({ type: 'ready' } satisfies WorkerToBroadcaster));
      console.log(`[broadcaster] hello event=${msg.eventId} source=${msg.sourceLang} targets=${msg.targetLangs.join(',')}`);
      break;
    }

    case 'transcript': {
      const state = events.get(ws.data.eventId ?? '');
      if (!state || state.paused) return;
      if (!msg.text.trim()) return;

      // Partial (draft) transcript — ignore, only translate committed finals (GVC method)
      if (!msg.final) return;

      // Store sentAt for latency echo-back
      const msg_sentAt = msg.sentAt;

      // Source captions fan-out immediately — captions are fine, translation needs buffering
      persistTranscript(state.eventId, msg.lang, msg.text, msg.ts).catch((err: unknown) => {
        console.error('[broadcaster] source transcript persist failed', err);
      });
      fanOutCaption(state, msg.lang, msg.text, msg.ts, true);

      if (state.targetLangs.length === 0) break;

      // Accumulate into buffer
      const bufferWasEmpty = !state.utteranceBuffer;
      state.utteranceBuffer = state.utteranceBuffer
        ? `${state.utteranceBuffer} ${msg.text}`
        : msg.text;

      // Record when the buffer first started filling
      if (bufferWasEmpty) state.utteranceBufferStartedAt = Date.now();

      // Force-flush if buffer has been accumulating too long (continuous speech guard)
      const bufferAge = Date.now() - (state.utteranceBufferStartedAt ?? Date.now());
      if (SENTENCE_END_RE.test(msg.text) || bufferAge >= MAX_BUFFER_MS) {
        if (state.utteranceBufferTimer) {
          clearTimeout(state.utteranceBufferTimer);
          state.utteranceBufferTimer = null;
        }
        flushTranslationBuffer(state, msg.ts, msg_sentAt);
      } else {
        // Reset trailing-silence timer
        if (state.utteranceBufferTimer) {
          clearTimeout(state.utteranceBufferTimer);
        }
        state.utteranceBufferTimer = setTimeout(() => {
          state.utteranceBufferTimer = null;
          flushTranslationBuffer(state, msg.ts, msg_sentAt);
        }, BUFFER_MS);
      }
      break;
    }

    case 'update_targets': {
      const state = events.get(ws.data.eventId ?? '');
      if (!state) return;
      state.targetLangs = msg.targetLangs;
      console.log(`[broadcaster] update_targets event=${state.eventId} targets=${msg.targetLangs.join(',')}`);
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
        console.log(`[broadcaster] update_glossary event=${state.eventId} terms=${Object.keys(msg.glossary).length}`);
      }
      break;
    }

    case 'request_handoff': {
      const state = events.get(ws.data.eventId ?? '');
      if (!state) return;
      // Forward handoff notification to the current broadcaster
      try {
        const handoffMsg: WorkerToBroadcaster = msg.displayName
          ? { type: 'handoff_requested', broadcasterId: msg.broadcasterId, displayName: msg.displayName }
          : { type: 'handoff_requested', broadcasterId: msg.broadcasterId };
        (state.broadcasterWs as unknown as ServerWebSocket<ClientMeta>)?.send(JSON.stringify(handoffMsg));
      } catch { /* broadcaster gone */ }
      break;
    }

    case 'pause': {
      const state = events.get(ws.data.eventId ?? '');
      if (state) {
        // Flush buffer before pausing so nothing is lost
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
      break;
    }
  }
}


function flushTranslationBuffer(state: EventState, ts: number, sentAt?: number): void {
  const text = state.utteranceBuffer.trim();
  state.utteranceBuffer = '';
  state.utteranceBufferStartedAt = null;

  if (!text) return;

  // Snapshot context before pushing the new utterance
  const priorSource = state.sourceHistory.slice(-CONTEXT_SIZE);
  const priorTranslated: Map<string, string[]> = new Map(
    [...state.targetLangs].map(lang => [
      lang,
      (state.translatedHistory.get(lang) ?? []).slice(-TRANSLATED_CONTEXT_SIZE),
    ])
  );

  state.sourceHistory.push(text);
  if (state.sourceHistory.length > CONTEXT_SIZE + 2) {
    state.sourceHistory.shift();
  }

  state.utteranceCount++;
  translateAllTargets(state, text, priorSource, priorTranslated, ts, sentAt);

  // Async topic summary update — never blocks translation
  if (state.utteranceCount % SUMMARY_INTERVAL === 0) {
    const recentUtterances = state.sourceHistory.slice(-SUMMARY_INTERVAL);
    generateTopicSummary(recentUtterances, state.topicSummary)
      .then(summary => { state.topicSummary = summary; })
      .catch((err: unknown) => console.error('[broadcaster] topic summary failed', err));
  }
}

function translateAllTargets(
  state: EventState,
  text: string,
  priorSource: string[],
  priorTranslated: Map<string, string[]>,
  ts: number,
  sentAt?: number,
): void {
  for (const targetLang of state.targetLangs) {
    // Skip paused languages
    if (state.pausedLangs.has(targetLang)) continue;

    const translatedContext = priorTranslated.get(targetLang) ?? [];

    // If a prior translation was still streaming when this one starts, commit its
    // last partial as final=true so the viewer clears cleanly before the new stream begins.
    const displaced = state.lastPartialByLang.get(targetLang);
    if (displaced) {
      fanOutCaption(state, targetLang, displaced.text, displaced.ts, true);
      state.lastPartialByLang.delete(targetLang);
    }

    const seq = (state.finalSeq.get(targetLang) ?? 0) + 1;
    state.finalSeq.set(targetLang, seq);

    translateTextStreaming({
      text,
      sourceLang: state.sourceLang === 'auto' ? 'auto-detected' : state.sourceLang,
      targetLang,
      priorContext: priorSource,
      translatedContext,
      glossary: state.glossary,
      knowledge: state.knowledge,
      ...(state.topicSummary ? { topicSummary: state.topicSummary } : {}),
      onPartial: (accumulated) => {
        if (state.finalSeq.get(targetLang) !== seq) return;
        state.lastPartialByLang.set(targetLang, { text: accumulated, ts });
        fanOutCaption(state, targetLang, accumulated, ts, false);
      },
    })
      .then((translated) => {
        if (!translated) return;
        if (state.finalSeq.get(targetLang) !== seq) return;
        state.lastPartialByLang.delete(targetLang);

        const history = state.translatedHistory.get(targetLang) ?? [];
        history.push(translated);
        if (history.length > CONTEXT_SIZE + 2) history.shift();
        state.translatedHistory.set(targetLang, history);

        persistTranscript(state.eventId, targetLang, translated, ts).catch((err: unknown) => {
          console.error(`[translation] persist failed lang=${targetLang}`, err);
        });
        fanOutCaption(state, targetLang, translated, ts, true);

        try {
          const echoMsg: WorkerToBroadcaster = sentAt !== undefined
            ? { type: 'transcript', lang: targetLang, text: translated, final: true, ts, sentAt }
            : { type: 'transcript', lang: targetLang, text: translated, final: true, ts };
          (state.broadcasterWs as unknown as ServerWebSocket<ClientMeta>)?.send(JSON.stringify(echoMsg));
        } catch { /* broadcaster gone */ }

        const viewerCount = state.viewers.get(targetLang)?.size ?? 0;
        if (viewerCount > 0 && !state.pipelines.has(targetLang)) {
          ensureTtsPipeline(state, targetLang, viewerCount);
        }
        const pipeline = state.pipelines.get(targetLang);
        if (pipeline) sendTextToTts(pipeline, translated);

        console.log(`[translation] event=${state.eventId} lang=${targetLang} "${translated.slice(0, 60)}"`);
      })
      .catch((err: unknown) => {
        console.error(`[translation] failed lang=${targetLang}`, err);
      });
  }
}

function fanOutCaption(
  state: EventState,
  lang: string,
  text: string,
  ts: number,
  final: boolean,
): void {
  const viewerSet = state.viewers.get(lang);
  if (!viewerSet || viewerSet.size === 0) return;
  const msg = JSON.stringify({ type: 'caption', text, ts, final });
  for (const viewer of viewerSet) {
    try {
      (viewer as unknown as ServerWebSocket<ClientMeta>).send(msg);
    } catch { /* viewer gone */ }
  }
}

async function lookupAndRegisterEvent(eventId: string, state: EventState): Promise<void> {
  const { data, error } = await supabase
    .from('events')
    .select('event_code, glossary, knowledge_domain, knowledge_subdomain, knowledge_specialty, knowledge_briefing, knowledge_keyterms, knowledge_term_translations')
    .eq('id', eventId)
    .single();

  if (error || !data) {
    console.error(`[broadcaster] could not find event=${eventId}`, error);
    return;
  }

  if (data.event_code) {
    state.eventCode = data.event_code as string;
    eventsByCode.set(data.event_code as string, eventId);
  }

  if (data.glossary && typeof data.glossary === 'object') {
    state.glossary = data.glossary as Record<string, string>;
  }

  const dbKnowledge = buildKnowledgeFromDb(data);
  if (dbKnowledge) {
    state.knowledge = dbKnowledge;
  }

  const region = process.env.FLY_REGION ?? 'dev';
  await supabase.from('events').update({ fly_region: region }).eq('id', eventId);

  console.log(`[broadcaster] registered event=${eventId} code=${state.eventCode} region=${region} knowledge=${!!state.knowledge}`);
}

function buildKnowledgeFromDb(data: Record<string, unknown>): EventKnowledge | null {
  const domain = (data.knowledge_domain as string | null) ?? '';
  const subdomain = (data.knowledge_subdomain as string | null) ?? '';
  const specialty = (data.knowledge_specialty as string | null) ?? '';
  const briefing = (data.knowledge_briefing as string | null) ?? '';
  const keyterms = (data.knowledge_keyterms as string[] | null) ?? [];
  const termTranslations = (data.knowledge_term_translations as Record<string, Record<string, string>> | null) ?? {};

  if (!domain && !briefing && keyterms.length === 0) return null;

  return { domain, subdomain, specialty, briefing, keyterms, ...(Object.keys(termTranslations).length > 0 ? { termTranslations } : {}) };
}

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
  if (error) console.error('[broadcaster] transcript_entries insert failed', error);
}

export async function teardownEvent(eventId: string): Promise<void> {
  const state = events.get(eventId);
  if (!state) return;

  // Flush any buffered text before teardown
  if (state.utteranceBufferTimer) {
    clearTimeout(state.utteranceBufferTimer);
    state.utteranceBufferTimer = null;
  }
  if (state.utteranceBuffer.trim()) {
    flushTranslationBuffer(state, Date.now());
  }

  for (const [, viewerSet] of state.viewers) {
    for (const viewer of viewerSet) {
      try {
        (viewer as unknown as ServerWebSocket<ClientMeta>).send(JSON.stringify({ type: 'event_ended' }));
      } catch { /* gone */ }
    }
  }

  for (const [, pipeline] of state.pipelines) {
    closeTtsPipeline(pipeline);
  }

  if (state.eventCode) eventsByCode.delete(state.eventCode);
  events.delete(eventId);
  console.log(`[broadcaster] torn down event=${eventId}`);
}
