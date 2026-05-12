import type { ServerWebSocket } from 'bun';
import type { ClientMeta, ViewerUp, WorkerToViewer, WorkerToBroadcaster, EventState } from '../types';
import { events, eventsByCode } from '../index';
import { closeTtsPipeline, ensureTtsPipeline } from '../lib/tts-pipeline';

function notifyBroadcasterListenerStats(state: EventState): void {
  const counts: Record<string, number> = {};
  for (const [lang, viewers] of state.viewers) {
    if (viewers.size > 0) counts[lang] = viewers.size;
  }
  try {
    (state.broadcasterWs as unknown as ServerWebSocket<ClientMeta>).send(
      JSON.stringify({ type: 'listener_stats', counts } satisfies WorkerToBroadcaster),
    );
  } catch { /* broadcaster gone */ }
}

const PIPELINE_TEARDOWN_GRACE_MS = 30_000;

export async function handleViewerMessage(
  ws: ServerWebSocket<ClientMeta>,
  msg: ViewerUp,
): Promise<void> {
  switch (msg.type) {
    case 'join': {
      const eventId = eventsByCode.get(msg.eventCode);
      const state = eventId ? events.get(eventId) : undefined;

      if (!state) {
        ws.send(JSON.stringify({ type: 'error', code: 'EVENT_NOT_FOUND', message: 'Event not found or not live' } satisfies WorkerToViewer));
        return;
      }

      ws.data.eventId = state.eventId;
      ws.data.lang = msg.lang;
      ws.data.role = 'viewer';

      if (!state.viewers.has(msg.lang)) {
        state.viewers.set(msg.lang, new Set());
      }
      state.viewers.get(msg.lang)!.add(ws as unknown as WebSocket);

      const reply: WorkerToViewer = { type: 'joined', lang: msg.lang, sampleRate: 48000 };
      ws.send(JSON.stringify(reply));

      const viewerCount = state.viewers.get(msg.lang)!.size;
      console.log(`[viewer] joined event=${state.eventId} lang=${msg.lang} total=${viewerCount}`);

      ensureTtsPipeline(state, msg.lang, viewerCount);
      notifyBroadcasterListenerStats(state);
      break;
    }

    case 'switch_lang': {
      const eventId = ws.data.eventId;
      const oldLang = ws.data.lang;
      if (!eventId || !oldLang) return;

      await removeViewer(ws, eventId, oldLang);

      ws.data.lang = msg.lang;
      const state = events.get(eventId);
      if (!state) return;

      if (!state.viewers.has(msg.lang)) {
        state.viewers.set(msg.lang, new Set());
      }
      state.viewers.get(msg.lang)!.add(ws as unknown as WebSocket);

      const reply: WorkerToViewer = { type: 'joined', lang: msg.lang, sampleRate: 48000 };
      ws.send(JSON.stringify(reply));

      const viewerCount = state.viewers.get(msg.lang)!.size;
      console.log(`[viewer] switched event=${eventId} ${oldLang}→${msg.lang}`);
      ensureTtsPipeline(state, msg.lang, viewerCount);
      notifyBroadcasterListenerStats(state);
      break;
    }

    case 'leave': {
      if (ws.data.eventId && ws.data.lang) {
        await removeViewer(ws, ws.data.eventId, ws.data.lang);
      }
      break;
    }
  }
}

export async function removeViewer(
  ws: ServerWebSocket<ClientMeta>,
  eventId: string,
  lang: string,
): Promise<void> {
  const state = events.get(eventId);
  if (!state) return;

  const viewerSet = state.viewers.get(lang);
  if (viewerSet) {
    viewerSet.delete(ws as unknown as WebSocket);
    const remaining = viewerSet.size;

    console.log(`[viewer] left event=${eventId} lang=${lang} remaining=${remaining}`);
    notifyBroadcasterListenerStats(state);

    if (remaining === 0) {
      scheduleLanguagePipelineTeardown(state, lang);
    }
  }
}


function scheduleLanguagePipelineTeardown(state: EventState, lang: string): void {
  const pipeline = state.pipelines.get(lang);
  if (!pipeline) return;

  pipeline.teardownTimer = setTimeout(() => {
    const current = events.get(state.eventId);
    if (!current) return;
    const viewerCount = current.viewers.get(lang)?.size ?? 0;
    if (viewerCount === 0) {
      console.log(`[pipeline] teardown lang=${lang} event=${state.eventId} peak=${pipeline.peakListeners}`);
      closeTtsPipeline(pipeline);
      current.pipelines.delete(lang);
    }
  }, PIPELINE_TEARDOWN_GRACE_MS);
}
