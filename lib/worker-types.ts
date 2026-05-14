// Shared WebSocket message contracts — duplicated here so the frontend
// doesn't need to reach into the worker's bun-typed source tree.
// Keep in sync with worker/src/types.ts

export interface EventKnowledge {
  domain: string;
  subdomain: string;
  specialty: string;
  briefing: string;
  keyterms: string[];
  /** { [term]: { [langCode]: overrideTranslation } } — empty means keep-as-is */
  termTranslations?: Record<string, Record<string, string>>;
}

export type BroadcasterUp =
  | { type: 'hello'; eventId: string; sourceLang: string; targetLangs: string[]; knowledge?: EventKnowledge }
  | { type: 'audio'; pcm16: ArrayBuffer }
  | { type: 'transcript'; lang: string; text: string; final: boolean; ts: number; sentAt?: number }
  | { type: 'update_targets'; targetLangs: string[] }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'pause_lang'; lang: string }
  | { type: 'resume_lang'; lang: string }
  | { type: 'update_glossary'; glossary: Record<string, string> }
  | { type: 'request_handoff'; broadcasterId: string; displayName?: string }
  | { type: 'end' };

export type WorkerToBroadcaster =
  | { type: 'ready' }
  | { type: 'transcript'; lang: 'source' | string; text: string; final: boolean; ts: number; sentAt?: number }
  | { type: 'listener_stats'; counts: Record<string, number> }
  | { type: 'handoff_requested'; broadcasterId: string; displayName?: string }
  | { type: 'error'; code: string; message: string };

export type ViewerUp =
  | { type: 'join'; eventCode: string; lang: string }
  | { type: 'switch_lang'; lang: string }
  | { type: 'leave' };

export type WorkerToViewer =
  | { type: 'joined'; lang: string; sampleRate: number }
  | { type: 'caption'; text: string; ts: number; final: boolean }
  | { type: 'speaking_started' }
  | { type: 'speaking_ended' }
  | { type: 'event_ended' }
  | { type: 'error'; code: string; message: string };
