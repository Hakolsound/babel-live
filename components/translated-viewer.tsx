"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LANGUAGES } from "@/lib/languages"
import { ViewerClient } from "@/lib/viewer-client"
import { AudioPlayer, isAudioDecoderSupported } from "@/lib/audio-player"
import { resolveWorkerUrl } from "@/lib/resolve-worker-url"

const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur', 'yi', 'dv']);
function isRtlLang(lang: string): boolean {
  return RTL_LANGS.has(lang.split('-')[0] ?? '');
}

// Character-level typewriter with error-correction.
// Finds common prefix between displayed and target; deletes back (fast) then types forward.
// resetKey bumps to wipe displayed to '' and restart — used when a new utterance begins.
function useTypewriter(target: string, resetKey: number): string {
  const [displayed, setDisplayed] = useState('')
  const ref = useRef<{ target: string; displayed: string; timer: ReturnType<typeof setTimeout> | null }>({
    target: '',
    displayed: '',
    timer: null,
  })

  // Keep ref in sync — step() reads this directly
  ref.current.target = target

  const schedule = useCallback(() => {
    if (ref.current.timer !== null) return
    function step() {
      const t = ref.current.target
      let d = ref.current.displayed
      if (d === t) { ref.current.timer = null; return }

      let commonLen = 0
      const minLen = Math.min(d.length, t.length)
      while (commonLen < minLen && d[commonLen] === t[commonLen]) commonLen++

      let delay: number
      if (d.length > commonLen) {
        d = d.slice(0, -1)
        delay = 10
      } else {
        d = t.slice(0, d.length + 1)
        const q = t.length - d.length
        delay = q > 20 ? 16 : q > 10 ? 24 : 30 + Math.random() * 14
      }
      ref.current.displayed = d
      setDisplayed(d)
      ref.current.timer = setTimeout(step, delay)
    }
    ref.current.timer = setTimeout(step, 0)
  }, [])

  // Hard reset on utterance boundary — clears to '' so new draft types in fresh
  useEffect(() => {
    if (ref.current.timer) { clearTimeout(ref.current.timer); ref.current.timer = null }
    ref.current.displayed = ''
    setDisplayed('')
    schedule()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => { schedule() }, [target, schedule])

  useEffect(() => {
    return () => { if (ref.current.timer) clearTimeout(ref.current.timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return displayed
}

interface Event {
  id: string
  uid: string
  title: string
  description: string | null
  event_code: string | null
  source_language: string
  target_languages: string[]
  tts_enabled: boolean
  fly_region: string | null
}

interface TranslatedEntry {
  id: string
  language_code: string
  text: string
  timestamp_ms: number
  is_final: boolean
  created_at: string
}

interface TranslatedViewerProps {
  event: Event
  initialLang: string | null
}

export function TranslatedViewer({ event, initialLang }: TranslatedViewerProps) {
  const defaultLang = (() => {
    if (initialLang && event.target_languages.includes(initialLang)) return initialLang
    return event.target_languages[0] ?? null
  })()

  const [selectedLang, setSelectedLang] = useState<string | null>(defaultLang)
  const [audioSupported, setAudioSupported] = useState(false)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [broadcastNotLive, setBroadcastNotLive] = useState(false)
  const [entries, setEntries] = useState<TranslatedEntry[]>([])
  const [isLive, setIsLive] = useState(false)
  const [langPickerOpen, setLangPickerOpen] = useState(false)
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const [suggestedLang, setSuggestedLang] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<ViewerClient | null>(null)
  const playerRef = useRef<AudioPlayer | null>(null)
  const currentLang = useRef<string | null>(null)

  useEffect(() => {
    setAudioSupported(isAudioDecoderSupported())
    // Check navigator.languages (ordered preference list) then navigator.language
    const candidates = [
      ...(navigator.languages ?? []),
      navigator.language,
    ].flatMap(l => [l, l.split('-')[0] ?? '']).filter(Boolean)
    const match = candidates.find(c => event.target_languages.includes(c)) ?? null
    if (match) {
      setSuggestedLang(match)
      if (!initialLang) setSelectedLang(match)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Connection ─────────────────────────────────────────────────────────────
  // Connects ViewerClient for captions always; creates AudioPlayer only when
  // TTS is available and the user has tapped the audio unlock button.

  const startViewer = useCallback(async (lang: string) => {
    if (!event.event_code) return
    const workerUrl = resolveWorkerUrl(event.fly_region)

    if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null }
    clientRef.current?.destroy()

    // Audio only when TTS is available and user has explicitly unlocked
    let player: AudioPlayer | null = null
    if (event.tts_enabled && audioSupported) {
      player = await AudioPlayer.create(48000)
      playerRef.current = player
    }

    const client = new ViewerClient(workerUrl, {
      onJoined: () => {
        setBroadcastNotLive(false)
        if (player) setAudioPlaying(true)
      },
      onCaption: (text, ts, final) => {
        setIsLive(true)
        if (!final) {
          setStreamingText(text)
        } else {
          setStreamingText(null)
          setEntries(prev => {
            const id = `ws-${ts}-${text.slice(0, 8)}`
            if (prev.some(e => e.text === text)) return prev
            // Merge into previous entry if it ended mid-sentence (dash) or was very short
            const last = prev[prev.length - 1]
            if (last) {
              const endsWithDash = last.text.trimEnd().endsWith('-')
              const isTooShort = last.text.trim().split(/\s+/).length < 5 && !/[.!?]\s*$/.test(last.text)
              if (endsWithDash || isTooShort) {
                const joined = endsWithDash
                  ? last.text.trimEnd().slice(0, -1).trimEnd() + ' ' + text
                  : last.text.trimEnd() + ' ' + text
                return [...prev.slice(0, -1), { ...last, text: joined }]
              }
            }
            return [...prev, {
              id,
              language_code: lang,
              text,
              timestamp_ms: ts,
              is_final: true,
              created_at: new Date().toISOString(),
            }]
          })
        }
      },
      onAudioFrame: (frame) => player?.pushFrame(frame),
      onEventEnded: () => { setAudioPlaying(false); setIsLive(false) },
      onError: (code) => { if (code === 'EVENT_NOT_FOUND') setBroadcastNotLive(true) },
      onDisconnected: () => setAudioPlaying(false),
    })
    clientRef.current = client
    client.join(event.event_code, lang)
  }, [event.tts_enabled, event.event_code, event.fly_region, audioSupported])

  // Auto-unlock when no audio is available — lets the connection start without user gesture
  const hasAudio = event.tts_enabled && audioSupported && !!event.event_code
  useEffect(() => {
    if (!hasAudio && selectedLang && !audioUnlocked) {
      setAudioUnlocked(true)
    }
  }, [hasAudio, selectedLang, audioUnlocked])

  const handleUnlock = useCallback(async () => {
    setAudioUnlocked(true)
    const player = playerRef.current
    if (player) {
      await player.unlock()
    } else if (selectedLang) {
      currentLang.current = selectedLang
      await startViewer(selectedLang)
      await playerRef.current?.unlock()
    }
  }, [selectedLang, startViewer])

  useEffect(() => {
    if (!selectedLang || !audioUnlocked) return
    if (currentLang.current === selectedLang) return
    if (currentLang.current && clientRef.current) {
      clientRef.current.switchLang(selectedLang)
      currentLang.current = selectedLang
      playerRef.current?.flush()
      return
    }
    currentLang.current = selectedLang
    startViewer(selectedLang).catch(console.error)
  }, [selectedLang, audioUnlocked, startViewer])

  useEffect(() => {
    if (!broadcastNotLive || !audioUnlocked || !selectedLang) return
    const timer = setTimeout(() => {
      currentLang.current = null
      clientRef.current?.destroy()
      clientRef.current = null
      setBroadcastNotLive(false)
      startViewer(selectedLang).catch(console.error)
    }, 5000)
    return () => clearTimeout(timer)
  }, [broadcastNotLive, audioUnlocked, selectedLang, startViewer])

  useEffect(() => {
    return () => { clientRef.current?.destroy(); playerRef.current?.destroy() }
  }, [])

  // Clear entries when lang changes
  useEffect(() => {
    setEntries([])
    setStreamingText(null)
  }, [selectedLang])

  // ── Typewriter ─────────────────────────────────────────────────────────────
  // Within one utterance: morphs smoothly (common prefix → delete back → type forward).
  // Across utterances: resets to '' so the next draft types in fresh instead of
  // deleting backwards through the previous committed sentence.
  const lastEntry = entries[entries.length - 1]
  const activeTarget = streamingText ?? lastEntry?.text ?? ''

  const prevIsStreamingRef = useRef(false)
  const [typewriterResetKey, setTypewriterResetKey] = useState(0)
  useEffect(() => {
    // New utterance started after a committed gap — reset typewriter
    if (!prevIsStreamingRef.current && streamingText !== null && entries.length > 0) {
      setTypewriterResetKey(k => k + 1)
    }
    prevIsStreamingRef.current = streamingText !== null
  }, [streamingText, entries.length])

  const displayedText = useTypewriter(activeTarget, typewriterResetKey)

  // Auto-scroll: pin to bottom on each character or new entry
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [displayedText, entries.length])

  // ── Derived ────────────────────────────────────────────────────────────────

  const langName = selectedLang
    ? (LANGUAGES.find((l) => l.code === selectedLang)?.name ?? selectedLang.toUpperCase())
    : null

  const isRtl = selectedLang ? isRtlLang(selectedLang) : false
  const isStreaming = streamingText !== null
  // When streaming: all committed entries are context (last 3 at fading opacity)
  // When not streaming: all committed entries are context except the last, which is shown
  //   via typewriter at full opacity as the "current" text
  const contextEntries = isStreaming ? entries.slice(-3) : entries.slice(-4, -1)
  const hasContent = entries.length > 0 || isStreaming
  const isMinimized = isLive && hasContent
  const isTyping = displayedText !== activeTarget

  // ── Phase: language pick ───────────────────────────────────────────────────

  if (!selectedLang || langPickerOpen) {
    return (
      <div className="flex-1 flex flex-col px-5 py-8 max-w-lg mx-auto w-full">
        <div className="mb-10">
          <h1 className="text-3xl font-black tracking-tight leading-tight">{event.title}</h1>
          {event.description && (
            <p className="mt-2 text-black/50 text-base leading-snug">{event.description}</p>
          )}
        </div>
        <p className="text-xs font-bold tracking-widest uppercase text-black/40 mb-4">
          Choose your language
        </p>
        <div className="space-y-2">
          {event.target_languages.length === 0 ? (
            <p className="text-black/40 text-sm">No languages configured yet.</p>
          ) : (
            [...event.target_languages]
              .sort((a, b) => (a === suggestedLang ? -1 : b === suggestedLang ? 1 : 0))
              .map((code) => {
                const name = LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase()
                const isSuggested = code === suggestedLang
                return (
                  <button
                    key={code}
                    onClick={() => { setSelectedLang(code); setLangPickerOpen(false) }}
                    className={`w-full flex items-center justify-between px-5 py-4 border-2 rounded-xl font-bold text-lg transition-colors active:scale-[0.98] ${
                      isSuggested
                        ? 'border-black bg-black text-white hover:bg-black/80'
                        : 'border-black/20 hover:border-black hover:bg-black hover:text-white'
                    }`}
                  >
                    <span>{name}</span>
                    <span className={`font-mono text-xs ${isSuggested ? 'opacity-60' : 'opacity-40'}`}>
                      {isSuggested ? 'Suggested' : code.toUpperCase()}
                    </span>
                  </button>
                )
              })
          )}
        </div>
      </div>
    )
  }

  // ── Phase: audio tap gate (TTS available but not yet unlocked) ─────────────

  if (hasAudio && !audioUnlocked) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
        <div className="mb-8 space-y-3">
          <h1 className="text-2xl font-black tracking-tight">{event.title}</h1>
          <p className="text-black/40 text-sm">
            Translated to{" "}
            <span className="font-bold text-black">{langName}</span>
          </p>
        </div>
        <button
          onClick={handleUnlock}
          className="w-full max-w-xs py-5 bg-black text-white font-black text-xl rounded-2xl hover:bg-black/80 active:scale-[0.97] transition-all"
        >
          Tap to listen
        </button>
        <button
          onClick={() => setLangPickerOpen(true)}
          className="mt-6 text-sm text-black/40 underline underline-offset-2"
        >
          Change language
        </button>
      </div>
    )
  }

  // ── Phase: live captions ───────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* Sticky status bar — shrinks when live content is visible */}
      <div
        className="flex items-center justify-between px-5 border-b border-black/8 transition-all duration-300 flex-shrink-0"
        style={{ paddingTop: isMinimized ? 5 : 12, paddingBottom: isMinimized ? 5 : 12 }}
      >
        <div className="flex items-center gap-2">
          {isLive ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse flex-shrink-0" />
              {!isMinimized && (
                <span className="text-[10px] font-bold tracking-widest uppercase text-black/50">Live</span>
              )}
            </>
          ) : (
            <span className="text-[10px] font-bold tracking-widest uppercase text-black/20">Waiting…</span>
          )}
          {hasAudio && audioUnlocked && audioPlaying && (
            <span className="text-[10px] text-black/30 ml-1">· 🔊</span>
          )}
        </div>
        <button
          onClick={() => setLangPickerOpen(true)}
          className="text-[10px] font-bold border border-black/15 rounded-full px-2.5 py-1 hover:border-black/40 transition-colors text-black/50"
        >
          {langName}
        </button>
      </div>

      {/* Scrollable area — content anchored to bottom, grows upward */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col justify-end px-5 pb-10 pt-8 gap-4">

          {!hasContent && (
            <p className="text-center text-black/20 text-sm font-medium">
              Waiting for the broadcast to start
            </p>
          )}

          {/* Fading committed context entries */}
          {contextEntries.map((entry, i) => {
            const fromEnd = contextEntries.length - 1 - i  // 0 = most recent
            const isCurrent = !isStreaming && fromEnd === 0
            const opacity = isCurrent ? 1 : fromEnd === 0 ? 0.5 : fromEnd === 1 ? 0.25 : 0.10
            const sizeClass = isCurrent
              ? 'text-[clamp(1.4rem,5.5vw,2.1rem)] font-semibold'
              : fromEnd === 0 ? 'text-lg font-medium'
              : fromEnd === 1 ? 'text-base font-normal'
              : 'text-sm font-normal'
            return (
              <p
                key={entry.id}
                className={`${sizeClass} leading-snug`}
                style={{ opacity, transition: 'opacity 0.5s ease', textAlign: isRtl ? 'right' : 'left' }}
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                {entry.text}
              </p>
            )
          })}

          {/* Active text — typewriter animated (streaming draft or last committed entry) */}
          {(displayedText.length > 0 || isStreaming) && (
            <p
              className="text-[clamp(1.4rem,5.5vw,2.1rem)] font-semibold leading-snug text-black"
              dir={isRtl ? 'rtl' : 'ltr'}
              style={{ textAlign: isRtl ? 'right' : 'left' }}
            >
              {displayedText}
              {(isStreaming || isTyping) && (
                <span className="text-black/25 animate-pulse"> ▍</span>
              )}
            </p>
          )}

        </div>
      </div>
    </div>
  )
}
