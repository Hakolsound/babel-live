// Shared WebSocket message contracts — duplicated here so the frontend
// doesn't need to reach into the worker's bun-typed source tree.
// Keep in sync with worker/src/types.ts

export type BroadcasterUp =
  | { type: 'hello'; eventId: string; sourceLang: string; targetLangs: string[] }
  | { type: 'audio'; pcm16: ArrayBuffer }
  | { type: 'transcript'; lang: string; text: string; final: boolean; ts: number }
  | { type: 'update_targets'; targetLangs: string[] }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'end' };

export type WorkerToBroadcaster =
  | { type: 'ready' }
  | { type: 'transcript'; lang: 'source' | string; text: string; final: boolean; ts: number }
  | { type: 'listener_stats'; counts: Record<string, number> }
  | { type: 'error'; code: string; message: string };
