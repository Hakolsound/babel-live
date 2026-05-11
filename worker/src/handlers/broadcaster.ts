import type { ServerWebSocket } from 'bun';
import type { ClientMeta, BroadcasterUp, WorkerToBroadcaster, EventState } from '../types';
import { events, eventsByCode } from '../index';
import { supabase } from '../lib/supabase';

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
        pipelines: new Map(),
        viewers: new Map(),
      };
      events.set(msg.eventId, state);

      // Look up event_code + update fly_region in Supabase
      lookupAndRegisterEvent(msg.eventId, state).catch((err: unknown) => {
        console.error(`[broadcaster] event lookup failed event=${msg.eventId}`, err);
      });

      const reply: WorkerToBroadcaster = { type: 'ready' };
      ws.send(JSON.stringify(reply));

      console.log(`[broadcaster] hello event=${msg.eventId} source=${msg.sourceLang} targets=${msg.targetLangs.join(',')}`);
      break;
    }

    case 'transcript': {
      const state = events.get(ws.data.eventId ?? '');
      if (!state || state.paused) return;

      // Phase 2: fan out to translation pipeline here
      // Phase 1: fan out source captions to source-lang viewers
      const viewerSet = state.viewers.get(msg.lang);
      if (viewerSet) {
        const caption = JSON.stringify({ type: 'caption', text: msg.text, ts: msg.ts, final: msg.final });
        for (const viewer of viewerSet) {
          try {
            (viewer as unknown as ServerWebSocket<ClientMeta>).send(caption);
          } catch { /* viewer may be gone */ }
        }
      }

      // Persist final source transcripts
      if (msg.final) {
        persistTranscript(state.eventId, msg.lang, msg.text, msg.ts).catch((err: unknown) => {
          console.error(`[broadcaster] transcript persist failed`, err);
        });
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
      // Unused in Option B (Scribe is browser-direct)
      break;
    }
  }
}

async function lookupAndRegisterEvent(eventId: string, state: EventState): Promise<void> {
  const { data, error } = await supabase
    .from('events')
    .select('event_code')
    .eq('id', eventId)
    .single();

  if (error || !data) {
    console.error(`[broadcaster] could not find event=${eventId}`, error);
    return;
  }

  if (data.event_code) {
    state.eventCode = data.event_code as string;
    eventsByCode.set(data.event_code as string, eventId);
    console.log(`[broadcaster] registered event=${eventId} code=${data.event_code}`);
  }

  // Record which Fly.io region owns this event
  const region = process.env.FLY_REGION ?? 'dev';
  await supabase.from('events').update({ fly_region: region }).eq('id', eventId);
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

  if (error) {
    console.error(`[broadcaster] transcript_entries insert failed`, error);
  }
}

export async function teardownEvent(eventId: string): Promise<void> {
  const state = events.get(eventId);
  if (!state) return;

  // Notify all viewers
  for (const [, viewerSet] of state.viewers) {
    for (const viewer of viewerSet) {
      try {
        (viewer as unknown as ServerWebSocket<ClientMeta>).send(
          JSON.stringify({ type: 'event_ended' }),
        );
      } catch { /* viewer may already be gone */ }
    }
  }

  // Phase 3+: tear down TTS pipelines here

  if (state.eventCode) {
    eventsByCode.delete(state.eventCode);
  }
  events.delete(eventId);
  console.log(`[broadcaster] torn down event=${eventId}`);
}
