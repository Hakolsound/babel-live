import type { ServerWebSocket } from 'bun';
import type { ClientMeta, ViewerUp, WorkerToViewer } from '../types';
import { events } from '../index';

const PIPELINE_TEARDOWN_GRACE_MS = 30_000;

export async function handleViewerMessage(
  ws: ServerWebSocket<ClientMeta>,
  msg: ViewerUp,
): Promise<void> {
  switch (msg.type) {
    case 'join': {
      const state = events.get(
        [...events.values()].find(e =>
          // Phase 0 stub: look up event by eventCode via in-memory map
          // Phase 1+: resolve eventCode → eventId via Supabase
          e.eventId === msg.eventCode
        )?.eventId ?? '',
      );

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

      console.log(`[viewer] joined event=${state.eventId} lang=${msg.lang} total=${state.viewers.get(msg.lang)!.size}`);

      // Phase 3: start language pipeline if not already running
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

      console.log(`[viewer] switched event=${eventId} ${oldLang}→${msg.lang}`);
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

    if (remaining === 0) {
      scheduleLanguagePipelineTeardown(eventId, lang);
    }
  }
}

function scheduleLanguagePipelineTeardown(eventId: string, lang: string): void {
  // Phase 3: this will tear down the TTS pipeline after grace period
  // For now, just log
  setTimeout(() => {
    const state = events.get(eventId);
    if (!state) return;
    const viewerCount = state.viewers.get(lang)?.size ?? 0;
    if (viewerCount === 0) {
      console.log(`[pipeline] teardown lang=${lang} event=${eventId} (grace period elapsed)`);
      state.pipelines.delete(lang);
    }
  }, PIPELINE_TEARDOWN_GRACE_MS);
}
