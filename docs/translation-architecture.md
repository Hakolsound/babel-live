# Babel — Translation Architecture

## Overview

Babel translates live speech in real time. A browser-side STT engine transcribes the broadcaster's microphone, finals are sent to a Fly.io worker, the worker fans each utterance through Claude for translation (streaming), stores the result in Supabase, and pushes translated captions + ElevenLabs TTS audio to every viewer WebSocket.

```
Broadcaster browser
  └─ Web Speech API (STT, cloud-backed)
        ↓  final transcript
  WorkerClient (WebSocket)
        ↓  { type: 'transcript', final: true }
Fly.io Worker (Bun)
  ├─ Utterance buffer (300 ms silence gate / 3.5 s force-flush)
  ├─ Claude Haiku 4.5  ──streaming──▶  caption fan-out  ──▶  Viewer WebSockets
  ├─ ElevenLabs Flash v2.5  ──Opus──▶  audio fan-out   ──▶  Viewer WebSockets
  └─ Supabase (transcript_entries)
```

---

## 1. Speech-to-Text (broadcaster side)

**Engine:** browser Web Speech API (Chrome/Edge backed by Google STT).

**Partial vs. final:** Only `final: true` transcripts are sent to the worker. Partials are displayed locally on the broadcast UI for speaker monitoring but are never translated (GVC method — translate committed speech only).

**Buffering on the worker:** Finals arriving within 300 ms of each other are merged into one utterance before translation. If speech is continuous for 3.5 s without a natural boundary, the buffer force-flushes. Utterances ending with sentence-final punctuation (`[.!?]`) flush immediately.

**Files:**
- `lib/worker-client.ts` — `WorkerClient.sendTranscript()`
- `worker/src/handlers/broadcaster.ts` — `handleBroadcasterMessage()`, `flushTranslationBuffer()`

---

## 2. Translation (worker side)

**Model:** `claude-haiku-4-5-20251001`

**Mode:** Streaming (`anthropic.messages.stream`). Partial tokens are emitted to viewers as `{ type: 'caption', final: false }` on word boundaries, giving a real-time typewriter effect.

### Prompt construction

Each translation call receives:

| Block | Content |
|---|---|
| System role | "Professional live interpreter. Translate from `sourceLang` to `targetLang`." |
| Filler/noise rules | Omit uh/um, clean false starts, render affirmations naturally |
| Session summary | 2–3 sentence rolling summary of what has been discussed (injected every 8 utterances) |
| Event knowledge | Domain, subdomain, specialty, briefing (from DB at event start) |
| Key terms | Terms that must never be translated (proper nouns, acronyms, brand names) |
| Term overrides | Per-language translation overrides for specific terms |
| Glossary | User-supplied `term → translation` pairs |
| Prior context | Last 6 source utterances + last 4 translated utterances (source → translation pairs) |
| User message | The utterance to translate |

### Context management

- `sourceHistory`: last 8 source utterances (rolling, trimmed to `CONTEXT_SIZE + 2 = 8`)
- `translatedHistory`: last 8 translated utterances per target language
- `topicSummary`: regenerated async every 8 utterances via `generateTopicSummary()`, never blocks translation
- `glossary`: loaded from `events.glossary` (JSONB) at event start; updated live via `update_glossary` messages

### Concurrency

All target languages are translated in parallel (`translateAllTargets` iterates target langs without `await`). Each language maintains a monotonic `finalSeq` counter — a new translation request that completes while a previous streaming one is still in-flight discards the older stream's remaining partials.

**Files:**
- `worker/src/lib/translate.ts` — `translateTextStreaming()`, `generateTopicSummary()`
- `worker/src/handlers/broadcaster.ts` — `flushTranslationBuffer()`, `translateAllTargets()`

---

## 3. Event Knowledge System

Before broadcasting, the broadcaster can run an automated research pipeline that enriches the translation prompt with domain knowledge.

### Research pipeline (`/api/research-event`)

1. Parallel web search (SerpAPI) + YouTube search
2. Parallel page text scraping + YouTube transcript extraction
3. Claude Haiku synthesizes a structured result:
   - `domain` (one of 12 canonical domains)
   - `subdomain` / `specialty`
   - `briefing` (2–3 sentence interpreter context)
   - 25–35 `keyterms` with tier (`core` / `common` / `advanced` / `rare`) and source

Results are stored in `events` table columns:
`knowledge_domain`, `knowledge_subdomain`, `knowledge_specialty`, `knowledge_briefing`, `knowledge_keyterms`, `knowledge_term_translations`

### Key term suggestions (`/api/suggest-keyterms`)

Given a domain/subdomain/specialty/briefing, Claude Haiku generates 24 terms that a translation AI would likely corrupt — eponyms, acronyms, brand names, Latin/Greek technical terms, neologisms. Returns tiered list for broadcaster review.

### Term translation overrides

Each key term can have per-language translation overrides stored in `knowledge_term_translations` (JSONB: `{ term: { lang: override } }`). These are injected as hard rules into the translation prompt via `buildTermOverridesBlock()`.

---

## 4. Caption Fan-Out

After each streaming partial and after the final translation:

```
fanOutCaption(state, targetLang, text, ts, final)
  → state.viewers.get(targetLang)  (Set<WebSocket>)
  → ws.send(JSON.stringify({ type: 'caption', text, ts, final }))
```

Partials (`final: false`) update the viewer's streaming text in real time. Finals (`final: true`) commit to the entry list. If a new translation starts before the prior stream finished, the in-flight partial is committed as `final: true` before the new stream begins (no torn display).

Translated finals are also echoed back to the broadcaster WebSocket so the broadcast UI can show a translation preview per language.

**File:** `worker/src/handlers/broadcaster.ts` — `fanOutCaption()`

---

## 5. TTS Audio Pipeline

**Provider:** ElevenLabs Flash v2.5 (`eleven_flash_v2_5`)  
**Format:** `opus_48000_128` — raw Opus packets at 48 kHz mono, 128 kbps  
**Latency optimization:** level 3 (aggressive)

### Per-language pipeline lifecycle

1. `ensureTtsPipeline()` is called when the first viewer joins a language or when a translation final arrives for a language that has viewers.
2. A WebSocket to ElevenLabs is opened. On `onopen`, a BOS (Beginning of Stream) message is sent with voice settings.
3. After each translated final, `sendTextToTts(pipeline, translated)` sends the text to ElevenLabs.
4. ElevenLabs responds with base64-encoded Opus chunks. Each chunk is prefixed with a 1-byte rolling sequence number (0–255) and sent as a binary WebSocket frame to all subscribed viewers.
5. When no viewers remain for a language, teardown is scheduled after a 30-second grace period (`PIPELINE_TEARDOWN_GRACE_MS`).

### Audio fan-out

```
fanOutAudio(state, lang, frame: Buffer)
  → state.viewers.get(lang)  (Set<WebSocket>)
  → ws.send(frame)           (binary: [seqByte][opusBytes])
```

**File:** `worker/src/lib/tts-pipeline.ts`

---

## 6. Audio Playback (viewer side)

**API:** WebCodecs `AudioDecoder` → `AudioWorkletNode` jitter buffer

### Decode path

1. `ViewerClient` receives binary WebSocket frames → calls `AudioPlayer.pushFrame(buffer)`
2. `pushFrame` strips the sequence byte, checks for desync (gap > 10 → flush jitter buffer), then feeds raw Opus to `AudioDecoder`
3. Each `EncodedAudioChunk` carries a monotonically increasing timestamp (20 ms increments) — required by the WebCodecs spec
4. Decoded `AudioData` → `Float32Array` samples → `AudioWorkletNode` jitter buffer → speakers

### Sequence gap handling

- **Small gaps (≤ 10):** normal packet loss, decoder continues
- **Large gaps (> 10):** jitter buffer flush + resync; decoder is reset via `flush()`

### Fallback

`isAudioDecoderSupported()` checks for `AudioDecoder`, `AudioContext`, and `AudioWorkletNode`. If any are missing (Safari < 17.4, some mobile browsers), audio is silently disabled and the viewer receives captions only.

**Files:**
- `lib/audio-player.ts` — `AudioPlayer`
- `lib/viewer-client.ts` — `ViewerClient`
- `components/translated-viewer.tsx` — integration

---

## 7. Persistence

Every finalized utterance (source + all translations) is written to `transcript_entries`:

| Column | Value |
|---|---|
| `event_id` | UUID |
| `language_code` | `"source"` or ISO-639-1 code |
| `text` | finalized text |
| `timestamp_ms` | ms since epoch (from broadcaster `ts`) |
| `is_final` | always `true` |

**File:** `worker/src/handlers/broadcaster.ts` — `persistTranscript()`

---

## 8. Worker State (`EventState`)

Each live event holds an in-memory state object on the Fly.io worker:

```
EventState {
  eventId, eventCode, sourceLang, targetLangs
  paused, pausedLangs
  broadcasterWs
  sourceHistory[]          // last 8 source utterances
  translatedHistory        // Map<lang, last 8 translations>
  utteranceBuffer          // pending STT finals
  utteranceCount           // triggers summary refresh
  topicSummary             // 2-3 sentence context for translator
  glossary                 // user-supplied term overrides
  knowledge                // AI-researched domain knowledge
  finalSeq                 // monotonic per-lang counter (stale stream guard)
  lastPartialByLang        // last emitted partial (commit-on-displace)
  pipelines                // Map<lang, LanguagePipeline>
  viewers                  // Map<lang, Set<WebSocket>>
}
```

State is entirely in-memory — no Redis, no sticky sessions required. If the worker restarts, the broadcaster reconnects and re-sends `hello` to rebuild state.

---

## 9. WebSocket Message Protocol

### Broadcaster → Worker

| Message | Purpose |
|---|---|
| `hello` | Open event with source lang, target langs, optional knowledge |
| `transcript` | Finalized STT text |
| `update_targets` | Change target language list live |
| `pause` / `resume` | Pause/resume all translation |
| `pause_lang` / `resume_lang` | Pause/resume a single language |
| `update_glossary` | Replace glossary terms |
| `request_handoff` | Trigger handoff notification to current broadcaster |
| `end` | Teardown event |

### Worker → Broadcaster

| Message | Purpose |
|---|---|
| `ready` | Worker accepted `hello` |
| `transcript` | Echo-back of translated finals (for broadcast UI preview) |
| `listener_stats` | Viewer counts per language |
| `handoff_requested` | Forwarded handoff request |

### Viewer → Worker

| Message | Purpose |
|---|---|
| `join` | Subscribe to event + language |
| `switch_lang` | Change language without reconnecting |
| `leave` | Unsubscribe |

### Worker → Viewer

| Frame | Purpose |
|---|---|
| `joined` (JSON) | Confirmed language + sample rate |
| `caption` (JSON) | Text update, `final: true/false` |
| `event_ended` (JSON) | Broadcast ended |
| binary | Raw Opus audio frame (`[seqByte][opusData]`) |
