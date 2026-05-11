import type { ServerWebSocket } from 'bun';
import type { ClientMeta, BroadcasterUp, WorkerToBroadcaster, EventState } from '../types';
import { events } from '../index';

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
        sourceLang: msg.sourceLang,
        targetLangs: msg.targetLangs,
        startedAt: Date.now(),
        paused: false,
        broadcasterWs: ws as unknown as WebSocket,
        pipelines: new Map(),
        viewers: new Map(),
      };
      events.set(msg.eventId, state);

      const reply: WorkerToBroadcaster = { type: 'ready' };
      ws.send(JSON.stringify(reply));

      console.log(`[broadcaster] event=${msg.eventId} source=${msg.sourceLang} targets=${msg.targetLangs.join(',')}`);
      break;
    }

    case 'update_targets': {
      const state = events.get(ws.data.eventId ?? '');
      if (!state) return;
      state.targetLangs = msg.targetLangs;
      console.log(`[broadcaster] event=${state.eventId} updated targets=${msg.targetLangs.join(',')}`);
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
      // Phase 1: relay PCM to Scribe (Option B means this path is unused)
      break;
    }
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

  events.delete(eventId);
  console.log(`[broadcaster] event=${eventId} torn down`);
}
