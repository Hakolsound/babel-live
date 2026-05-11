import type { ServerWebSocket } from 'bun';
import type { ClientMeta, BroadcasterUp, WorkerToBroadcaster, EventState } from '../types';
import { events, eventsByCode } from '../index';
import { supabase } from '../lib/supabase';
import { translateText } from '../lib/translate';

const SOURCE_HISTORY_SIZE = 2;

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
        broadcasterWs: ws as unknown as WebSocket,
        sourceHistory: [],
        glossary: {},
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
      if (!state || state.paused || !msg.final) return;

      // Update source history (rolling window)
      state.sourceHistory.push(msg.text);
      if (state.sourceHistory.length > SOURCE_HISTORY_SIZE) {
        state.sourceHistory.shift();
      }

      // Persist source transcript
      persistTranscript(state.eventId, msg.lang, msg.text, msg.ts).catch((err: unknown) => {
        console.error('[broadcaster] source transcript persist failed', err);
      });

      // Fan source caption to viewers watching this language
      fanOutCaption(state, msg.lang, msg.text, msg.ts, true);

      // Translate to each active target language in parallel
      if (state.targetLangs.length > 0) {
        const context = [...state.sourceHistory.slice(0, -1)]; // prior utterances only
        translateAllTargets(state, msg.text, context, msg.ts);
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

    case 'pause': {
      const state = events.get(ws.data.eventId ?? '');
      if (state) state.paused = true;
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
      // Unused in Option B
      break;
    }
  }
}

function translateAllTargets(
  state: EventState,
  text: string,
  priorContext: string[],
  ts: number,
): void {
  for (const targetLang of state.targetLangs) {
    translateText({
      text,
      sourceLang: state.sourceLang === 'auto' ? 'auto-detected' : state.sourceLang,
      targetLang,
      priorContext,
      glossary: state.glossary,
    })
      .then((translated) => {
        persistTranscript(state.eventId, targetLang, translated, ts).catch((err: unknown) => {
          console.error(`[translation] persist failed lang=${targetLang}`, err);
        });
        fanOutCaption(state, targetLang, translated, ts, true);
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
    .select('event_code, glossary')
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

  const region = process.env.FLY_REGION ?? 'dev';
  await supabase.from('events').update({ fly_region: region }).eq('id', eventId);

  console.log(`[broadcaster] registered event=${eventId} code=${state.eventCode} region=${region}`);
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

  for (const [, viewerSet] of state.viewers) {
    for (const viewer of viewerSet) {
      try {
        (viewer as unknown as ServerWebSocket<ClientMeta>).send(JSON.stringify({ type: 'event_ended' }));
      } catch { /* gone */ }
    }
  }

  if (state.eventCode) eventsByCode.delete(state.eventCode);
  events.delete(eventId);
  console.log(`[broadcaster] torn down event=${eventId}`);
}
