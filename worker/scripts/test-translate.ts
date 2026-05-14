/**
 * Translation quality test feed — with optional TTS playback.
 *
 * Replays a .vtt caption file through the translation pipeline at real (or scaled)
 * timing, prints source + translation side by side, and (with --play) speaks the
 * translation aloud through ElevenLabs → afplay.
 *
 * Usage:
 *   bun run scripts/test-translate.ts --vtt /path/to/captions.vtt --target he --play
 *
 * Key flags:
 *   --vtt         Path to .vtt file (required)
 *   --source      Source language (default: en)
 *   --target      Target language code (default: he)
 *   --context     Prior utterances to pass (default: 6)
 *   --buffer      Buffer window ms (default: 2000)
 *   --model       Claude model (default: claude-haiku-4-5-20251001)
 *   --speed       Playback speed multiplier (default: 1, use 5-10 for fast dry runs)
 *   --play        Synthesize + play each translated chunk via ElevenLabs
 *   --voice       ElevenLabs voice ID (default: env ELEVENLABS_VOICE_ID or Sarah)
 *   --topic-summary  Enable rolling topic summary injection (default: true)
 *   --knowledge   Path to JSON file or inline JSON with EventKnowledge
 */

import { translateText, generateTopicSummary } from '../src/lib/translate';
import type { EventKnowledge } from '../src/types';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync, spawn } from 'child_process';

// ── VTT parser ──────────────────────────────────────────────────────────────

interface VttCue {
  startMs: number;
  text: string;
}

function parseVtt(content: string): VttCue[] {
  const cues: VttCue[] = [];
  const blocks = content.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const startStr = timeLine.split('-->')[0].trim();
    const text = lines
      .filter(l => !l.includes('-->') && !/^\d+$/.test(l.trim()) && l.trim() !== 'WEBVTT')
      .join(' ').trim();
    if (text) cues.push({ startMs: parseTimestamp(startStr), text });
  }
  return cues;
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':');
  if (parts.length === 3) return (parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])) * 1000;
  if (parts.length === 2) return (parseInt(parts[0]) * 60 + parseFloat(parts[1])) * 1000;
  return parseFloat(ts) * 1000;
}

// ── TTS ─────────────────────────────────────────────────────────────────────

async function synthesizeAndPlay(text: string, voiceId: string, apiKey: string): Promise<void> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs TTS failed ${res.status}: ${err}`);
  }

  const audioBytes = await res.arrayBuffer();
  const tmpFile = resolve(tmpdir(), `babel_tts_${Date.now()}.mp3`);
  writeFileSync(tmpFile, Buffer.from(audioBytes));

  // Play in background (non-blocking) — next chunk can start translating while this plays
  const proc = spawn('afplay', [tmpFile], { detached: true, stdio: 'ignore' });
  proc.unref();

  // Clean up file once playback finishes (best-effort)
  proc.on('close', () => { try { unlinkSync(tmpFile); } catch { /* gone */ } });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] ?? 'true';
      i++;
    }
  }
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtTimecode(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

const SENTENCE_END_RE = /[.!?]["']?\s*$/;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (!args['vtt']) {
    console.error('Usage: bun run scripts/test-translate.ts --vtt /path/to/file.vtt [--play]');
    process.exit(1);
  }

  const sourceLang = args['source'] ?? 'en';
  const targetLang = args['target'] ?? 'he';
  const contextSize = parseInt(args['context'] ?? '6', 10);
  const bufferMs = parseInt(args['buffer'] ?? '2000', 10);
  const model = args['model'] ?? 'claude-haiku-4-5-20251001';
  const speed = parseFloat(args['speed'] ?? '1');
  const playAudio = args['play'] === 'true';
  const useTopicSummary = args['topic-summary'] !== 'false';
  const voiceId = args['voice'] ?? process.env.ELEVENLABS_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL';
  const elevenKey = process.env.ELEVENLABS_API_KEY ?? '';

  if (playAudio && !elevenKey) {
    console.error('--play requires ELEVENLABS_API_KEY env var');
    process.exit(1);
  }

  let knowledge: EventKnowledge | null = null;
  if (args['knowledge']) {
    const raw = args['knowledge'];
    knowledge = raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(readFileSync(resolve(raw), 'utf-8'));
  }

  const cues = parseVtt(readFileSync(resolve(args['vtt']), 'utf-8'));

  console.log(`\nBabel Translation Test Feed`);
  console.log(`Source : ${sourceLang}  →  Target: ${targetLang}`);
  console.log(`Model  : ${model}  |  Buffer: ${bufferMs}ms  |  Context: ${contextSize}  |  Speed: ${speed}x`);
  console.log(`Audio  : ${playAudio ? `ElevenLabs voice=${voiceId}` : 'disabled (add --play to hear it)'}`);
  console.log(`Summary: ${useTopicSummary ? 'enabled' : 'disabled'}`);
  console.log(`Cues   : ${cues.length}`);
  console.log('─'.repeat(80));

  // Session state
  const sourceHistory: string[] = [];
  const translatedHistory: string[] = [];
  let topicSummary = '';
  let utteranceCount = 0;
  const stats = { utterances: 0, totalLatencyMs: 0, maxLatencyMs: 0 };

  // Buffer state
  let bufferText = '';
  let bufferFlushTimer: ReturnType<typeof setTimeout> | null = null;

  async function flushBuffer(ts: number) {
    const text = bufferText.trim();
    bufferText = '';
    if (!text) return;

    const priorSource = sourceHistory.slice(-contextSize);
    const priorTranslated = translatedHistory.slice(-contextSize);

    sourceHistory.push(text);
    if (sourceHistory.length > contextSize + 2) sourceHistory.shift();

    utteranceCount++;
    stats.utterances++;

    console.log(`\n  \x1b[2m→ chunk\x1b[0m \x1b[1m${text}\x1b[0m`);

    const t0 = Date.now();
    let translated = '';
    try {
      translated = await translateText({
        text,
        sourceLang,
        targetLang,
        priorContext: priorSource,
        translatedContext: priorTranslated,
        glossary: {},
        knowledge,
        ...(useTopicSummary && topicSummary ? { topicSummary } : {}),
        model,
      });

      const latencyMs = Date.now() - t0;
      stats.totalLatencyMs += latencyMs;
      stats.maxLatencyMs = Math.max(stats.maxLatencyMs, latencyMs);

      translatedHistory.push(translated);
      if (translatedHistory.length > contextSize + 2) translatedHistory.shift();

      console.log(`  \x1b[32m[${targetLang.toUpperCase()}]\x1b[0m ${translated}  \x1b[2m(${fmtMs(latencyMs)})\x1b[0m`);

      // TTS — fire and forget, don't block next chunk
      if (playAudio && translated.trim()) {
        synthesizeAndPlay(translated, voiceId, elevenKey).catch(err => {
          console.error(`  [TTS error] ${err.message}`);
        });
      }
    } catch (err) {
      console.error(`  [translation error] ${err}`);
    }

    // Async topic summary every 8 utterances
    if (useTopicSummary && utteranceCount % 8 === 0) {
      const recent = sourceHistory.slice(-8);
      generateTopicSummary(recent, topicSummary)
        .then(s => {
          topicSummary = s;
          console.log(`\n  \x1b[2m[topic summary updated]\x1b[0m`);
        })
        .catch(() => {});
    }
  }

  // Replay cues at VTT timing
  const firstCueStart = cues[0]?.startMs ?? 0;
  const wallStart = Date.now();

  for (const cue of cues) {
    const targetWall = wallStart + (cue.startMs - firstCueStart) / speed;
    const waitMs = targetWall - Date.now();
    if (waitMs > 0) await sleep(waitMs);

    process.stdout.write(`\x1b[2m[${fmtTimecode(cue.startMs)}]\x1b[0m ${cue.text}\n`);

    bufferText = bufferText ? `${bufferText} ${cue.text}` : cue.text;

    if (bufferFlushTimer) clearTimeout(bufferFlushTimer);

    if (SENTENCE_END_RE.test(cue.text)) {
      bufferFlushTimer = null;
      await flushBuffer(cue.startMs);
    } else {
      bufferFlushTimer = setTimeout(async () => {
        bufferFlushTimer = null;
        await flushBuffer(cue.startMs);
      }, bufferMs / speed);
    }
  }

  if (bufferFlushTimer) clearTimeout(bufferFlushTimer);
  if (bufferText.trim()) await flushBuffer(Date.now());

  // Stats
  const avg = stats.utterances > 0 ? Math.round(stats.totalLatencyMs / stats.utterances) : 0;
  console.log('\n' + '─'.repeat(80));
  console.log(`Done.  ${stats.utterances} utterances  |  avg ${fmtMs(avg)}  |  max ${fmtMs(stats.maxLatencyMs)}`);
  if (playAudio) console.log('Audio still playing in background…');
}

main().catch(console.error);
