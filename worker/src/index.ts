import type { ServerWebSocket } from 'bun';
import type { ClientMeta, BroadcasterUp, ViewerUp, WorkerToBroadcaster, WorkerToViewer, EventState } from './types';
import { handleBroadcasterMessage } from './handlers/broadcaster';
import { handleViewerMessage } from './handlers/viewer';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const FLY_REGION = process.env.FLY_REGION ?? 'dev';

/** Active events on this worker instance, keyed by eventId */
export const events = new Map<string, EventState>();

/** Secondary index: event_code → eventId, for fast viewer joins */
export const eventsByCode = new Map<string, string>();

/** Maps each WebSocket to its metadata */
export const clientMeta = new WeakMap<ServerWebSocket<ClientMeta>, ClientMeta>();

const server = Bun.serve<ClientMeta>({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      const activePipelines = [...events.values()].reduce(
        (sum, e) => sum + e.pipelines.size,
        0,
      );
      return Response.json({
        ok: true,
        region: FLY_REGION,
        activeEvents: events.size,
        activePipelines,
      });
    }

    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req, { data: { role: null, eventId: null, lang: null } });
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    return new Response('Not found', { status: 404 });
  },

  websocket: {
    idleTimeout: 120,

    open(ws) {
      console.log(`[ws] client connected`);
    },

    message(ws, raw) {
      if (typeof raw !== 'string') {
        // Binary frame — only broadcasters send PCM (unused in Option B, but handle gracefully)
        return;
      }

      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'PARSE_ERROR', message: 'Invalid JSON' } satisfies WorkerToViewer));
        return;
      }

      const meta = ws.data;

      if (meta.role === 'broadcaster') {
        handleBroadcasterMessage(ws, msg as BroadcasterUp).catch((err: unknown) => {
          console.error('[broadcaster] unhandled error', err);
          ws.send(JSON.stringify({ type: 'error', code: 'INTERNAL', message: 'Internal error' } satisfies WorkerToBroadcaster));
        });
        return;
      }

      if (meta.role === 'viewer') {
        handleViewerMessage(ws, msg as ViewerUp).catch((err: unknown) => {
          console.error('[viewer] unhandled error', err);
          ws.send(JSON.stringify({ type: 'error', code: 'INTERNAL', message: 'Internal error' } satisfies WorkerToViewer));
        });
        return;
      }

      // Role not yet assigned — first message must be 'hello' (broadcaster) or 'join' (viewer)
      const firstMsg = msg as Record<string, unknown>;
      if (firstMsg['type'] === 'hello') {
        ws.data.role = 'broadcaster';
        handleBroadcasterMessage(ws, msg as BroadcasterUp).catch((err: unknown) => {
          console.error('[broadcaster] unhandled error', err);
        });
      } else if (firstMsg['type'] === 'join') {
        ws.data.role = 'viewer';
        handleViewerMessage(ws, msg as ViewerUp).catch((err: unknown) => {
          console.error('[viewer] unhandled error', err);
        });
      } else {
        ws.send(JSON.stringify({ type: 'error', code: 'IDENTIFY_FIRST', message: 'Send hello or join first' } satisfies WorkerToViewer));
      }
    },

    close(ws) {
      const meta = ws.data;
      console.log(`[ws] client disconnected role=${meta.role ?? 'unknown'} event=${meta.eventId ?? 'none'}`);

      if (meta.role === 'broadcaster' && meta.eventId) {
        handleBroadcasterDisconnect(ws).catch((err: unknown) => {
          console.error('[broadcaster] disconnect error', err);
        });
      } else if (meta.role === 'viewer' && meta.eventId && meta.lang) {
        handleViewerDisconnect(ws).catch((err: unknown) => {
          console.error('[viewer] disconnect error', err);
        });
      }
    },

  },
});

async function handleBroadcasterDisconnect(ws: ServerWebSocket<ClientMeta>): Promise<void> {
  const { teardownEvent } = await import('./handlers/broadcaster');
  await teardownEvent(ws.data.eventId!);
}

async function handleViewerDisconnect(ws: ServerWebSocket<ClientMeta>): Promise<void> {
  const { removeViewer } = await import('./handlers/viewer');
  await removeViewer(ws, ws.data.eventId!, ws.data.lang!);
}

console.log(`[babel-worker] listening on :${PORT} region=${FLY_REGION}`);
