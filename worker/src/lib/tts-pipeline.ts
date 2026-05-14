import type { EventState, LanguagePipeline, ClientMeta } from '../types';
import type { ServerWebSocket } from 'bun';

// ElevenLabs Flash v2.5 WebSocket streaming
// output_format: opus_48000_128 = Opus at 48kHz, 128kbps (Business tier)
// Fallback: opus_24000 if 48k is unavailable — change constant and update viewer sampleRate
const TTS_OUTPUT_FORMAT = 'opus_48000_128';
const TTS_SAMPLE_RATE = 48000;
const TTS_CHANNELS = 1; // mono voice
const FLASH_MODEL = 'eleven_flash_v2_5';
const OPTIMIZE_LATENCY = '3'; // 0-4; 3 = aggressive latency reduction

export { TTS_SAMPLE_RATE, TTS_CHANNELS };

function buildTtsUrl(voiceId: string): string {
  const base = 'wss://api.elevenlabs.io/v1/text-to-speech';
  return `${base}/${voiceId}/stream-input?model_id=${FLASH_MODEL}&output_format=${TTS_OUTPUT_FORMAT}&optimize_streaming_latency=${OPTIMIZE_LATENCY}`;
}

export function createTtsPipeline(
  apiKey: string,
  voiceId: string,
  lang: string,
  onAudioFrame: (frame: Buffer) => void,
  onClose: () => void,
): LanguagePipeline {
  const pipeline: LanguagePipeline = {
    lang,
    ttsWs: null,
    ttsReady: false,
    seqNum: 0,
    teardownTimer: null,
    peakListeners: 0,
    totalAudioMs: 0,
    sessionId: null,
  };

  const url = buildTtsUrl(voiceId);
  const ws = new WebSocket(url);
  pipeline.ttsWs = ws;

  ws.onopen = () => {
    // BOS: voice settings + API key
    ws.send(JSON.stringify({
      text: ' ',
      voice_settings: { stability: 0.45, similarity_boost: 0.75, use_speaker_boost: false },
      generation_config: { chunk_length_schedule: [50, 100, 150, 200] },
      xi_api_key: apiKey,
    }));
    pipeline.ttsReady = true;
    console.log(`[tts] pipeline ready lang=${lang}`);
  };

  ws.onmessage = (evt) => {
    if (typeof evt.data !== 'string') return;

    let msg: { audio?: string; isFinal?: boolean; message?: string; error?: unknown };
    try { msg = JSON.parse(evt.data as string); } catch { return; }

    if (msg.message || msg.error) {
      console.error(`[tts] error lang=${lang}`, msg.message ?? msg.error);
      return;
    }

    if (msg.audio) {
      const binary = Buffer.from(msg.audio, 'base64');

      // Prepend 1-byte rolling sequence number
      const frame = Buffer.allocUnsafe(1 + binary.length);
      frame[0] = pipeline.seqNum;
      binary.copy(frame, 1);
      pipeline.seqNum = (pipeline.seqNum + 1) & 0xff;

      // Track audio duration (rough: opus_48000_128 ≈ 16ms per typical chunk)
      pipeline.totalAudioMs += Math.round((binary.length / 128000) * 8 * 1000);

      onAudioFrame(frame);
    }
  };

  ws.onclose = () => {
    pipeline.ttsReady = false;
    console.log(`[tts] pipeline closed lang=${lang}`);
    onClose();
  };

  ws.onerror = () => {
    console.error(`[tts] ws error lang=${lang}`);
  };

  return pipeline;
}

/** Send a text chunk to an active TTS pipeline. */
export function sendTextToTts(pipeline: LanguagePipeline, text: string): void {
  if (!pipeline.ttsReady || pipeline.ttsWs?.readyState !== WebSocket.OPEN) return;
  // Trailing space gives ElevenLabs sentence boundary hint
  pipeline.ttsWs.send(JSON.stringify({ text: text + ' ' }));
}

/** Gracefully close a TTS pipeline with EOS signal. */
export function closeTtsPipeline(pipeline: LanguagePipeline): void {
  if (pipeline.ttsWs?.readyState === WebSocket.OPEN) {
    try { pipeline.ttsWs.send(JSON.stringify({ text: '' })); } catch { /* gone */ }
  }
  pipeline.ttsWs?.close();
  pipeline.ttsWs = null;
  pipeline.ttsReady = false;
}

const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

/**
 * Start a TTS pipeline for `lang` if not already running.
 * Safe to call multiple times — cancels any pending teardown timer.
 */
export function ensureTtsPipeline(state: EventState, lang: string, viewerCount: number): void {
  const existing = state.pipelines.get(lang);
  if (existing) {
    if (existing.teardownTimer) {
      clearTimeout(existing.teardownTimer);
      existing.teardownTimer = null;
    }
    existing.peakListeners = Math.max(existing.peakListeners, viewerCount);
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('[tts] ELEVENLABS_API_KEY not set — audio disabled');
    return;
  }
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;

  const pipeline = createTtsPipeline(
    apiKey,
    voiceId,
    lang,
    (frame) => fanOutAudio(state, lang, frame),
    () => {
      state.pipelines.delete(lang);
      console.log(`[tts] pipeline dropped lang=${lang} event=${state.eventId}`);
    },
  );
  pipeline.peakListeners = viewerCount;
  state.pipelines.set(lang, pipeline);
  console.log(`[pipeline] started lang=${lang} event=${state.eventId}`);
}

/** Fan Opus frame out to every viewer WebSocket subscribed to this language. */
export function fanOutAudio(
  state: EventState,
  lang: string,
  frame: Buffer,
): void {
  const viewerSet = state.viewers.get(lang);
  if (!viewerSet || viewerSet.size === 0) return;
  for (const viewer of viewerSet) {
    try {
      (viewer as unknown as ServerWebSocket<ClientMeta>).send(frame);
    } catch { /* viewer gone */ }
  }
}
