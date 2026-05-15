"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LANGUAGES } from "@/lib/languages"
import { ViewerClient, type CaptionEvent, type ViewerMode } from "@/lib/viewer-client"
import { AudioPlayer, checkAudioSupport } from "@/lib/audio-player"
import { resolveWorkerUrl } from "@/lib/resolve-worker-url"

const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur', 'yi', 'dv']);
function isRtlLang(lang: string): boolean {
  return RTL_LANGS.has(lang.split('-')[0] ?? '');
}

// ── Typewriter ─────────────────────────────────────────────────────────────────
// Character-level morph: finds common prefix, deletes back fast, types forward.
// resetKey clears to '' — used on utterance boundary.

function useTypewriter(target: string, resetKey: number): string {
  const [displayed, setDisplayed] = useState('')
  const ref = useRef<{ target: string; displayed: string; timer: ReturnType<typeof setTimeout> | null }>({
    target: '',
    displayed: '',
    timer: null,
  })
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
        d = d.slice(0, -1); delay = 10
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

// ── Types ──────────────────────────────────────────────────────────────────────

interface CommittedEntry {
  id: string          // utteranceId
  text: string
  lang: string
  ts: number
}

interface StreamingEntry {
  utteranceId: string
  text: string
  stability: 'partial' | 'stable'
  seq: number
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

interface TranslatedViewerProps {
  event: Event
  initialLang: string | null
}

const VIEWER_MODES: ViewerMode[] = ['fast', 'balanced', 'accurate', 'captions_only', 'audio_only'];
const MODE_LABEL: Record<ViewerMode, string> = {
  fast: 'Fast',
  balanced: 'Live',
  accurate: 'Accurate',
  captions_only: 'Captions',
  audio_only: 'Audio',
};

function loadMode(): ViewerMode {
  if (typeof window === 'undefined') return 'balanced';
  return (localStorage.getItem('babel_viewer_mode') as ViewerMode | null) ?? 'balanced';
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TranslatedViewer({ event, initialLang }: TranslatedViewerProps) {
  const defaultLang = (() => {
    if (initialLang && event.target_languages.includes(initialLang)) return initialLang
    return event.target_languages[0] ?? null
  })()

  const [selectedLang, setSelectedLang] = useState<string | null>(defaultLang)
  const [viewerMode, setViewerModeState] = useState<ViewerMode>(loadMode)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [broadcastNotLive, setBroadcastNotLive] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [langPickerOpen, setLangPickerOpen] = useState(false)
  const [modePickerOpen, setModePickerOpen] = useState(false)
  const [entries, setEntries] = useState<CommittedEntry[]>([])
  const [streaming, setStreaming] = useState<StreamingEntry | null>(null)
  const [suggestedLang, setSuggestedLang] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<ViewerClient | null>(null)
  const playerRef = useRef<AudioPlayer | null>(null)
  const currentLang = useRef<string | null>(null)
  const audioSupport = useRef(checkAudioSupport()).current

  const setViewerMode = useCallback((mode: ViewerMode) => {
    setViewerModeState(mode)
    localStorage.setItem('babel_viewer_mode', mode)
  }, [])

  // Detect browser language match on mount
  useEffect(() => {
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

  // ── Caption handler ────────────────────────────────────────────────────────

  const handleCaption = useCallback((caption: CaptionEvent) => {
    const { utteranceId, text, stability } = caption

    if (stability === 'superseded') {
      // Displaced by a new utterance — discard, never commit
      setStreaming(prev => prev?.utteranceId === utteranceId ? null : prev)
      return
    }

    if (stability === 'corrected') {
      setEntries(prev => prev.map(e => e.id === utteranceId ? { ...e, text } : e))
      return
    }

    if (stability === 'final') {
      setStreaming(prev => prev?.utteranceId === utteranceId ? null : prev)
      if (text.trim()) {
        setIsLive(true)
        setEntries(prev => {
          if (prev.some(e => e.id === utteranceId)) return prev
          return [...prev, { id: utteranceId, text, lang: caption.lang, ts: caption.ts }]
        })
      }
      return
    }

    // partial or stable — update streaming slot
    setIsLive(true)
    setStreaming({ utteranceId, text, stability, seq: caption.seq })
  }, [])

  // ── Connection ─────────────────────────────────────────────────────────────

  const startViewer = useCallback(async (lang: string, mode: ViewerMode) => {
    if (!event.event_code) return
    const workerUrl = resolveWorkerUrl(event.fly_region)

    if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null }
    clientRef.current?.destroy()

    const wantsAudio = event.tts_enabled && audioSupport.supported && mode !== 'captions_only'

    let player: AudioPlayer | null = null
    if (wantsAudio) {
      try {
        player = await AudioPlayer.create(48000)
        playerRef.current = player
      } catch (err) {
        console.error('[viewer] AudioPlayer.create failed', err)
      }
    }

    const client = new ViewerClient(workerUrl, {
      onJoined: (joinedLang, _sampleRate) => {
        setBroadcastNotLive(false)
        setIsReconnecting(false)
        if (player) setAudioPlaying(true)
        console.log(`[viewer] joined lang=${joinedLang} mode=${mode}`)
      },
      onCaption: handleCaption,
      onAudioFrame: (frame) => {
        if (mode !== 'captions_only') player?.pushFrame(frame)
      },
      onEventEnded: () => { setAudioPlaying(false); setIsLive(false) },
      onError: (code) => {
        if (code === 'EVENT_NOT_FOUND') setBroadcastNotLive(true)
      },
      onDisconnected: () => { setAudioPlaying(false); setIsReconnecting(false) },
      onReconnecting: (attempt) => {
        setIsReconnecting(true)
        console.log(`[viewer] reconnecting attempt=${attempt}`)
      },
    })
    clientRef.current = client
    client.join(event.event_code, lang, mode)
  }, [event.tts_enabled, event.event_code, event.fly_region, audioSupport.supported, handleCaption])

  // Caption-only mode or no TTS: auto-unlock (no user gesture required)
  const needsAudioUnlock = event.tts_enabled && audioSupport.supported
    && viewerMode !== 'captions_only' && !!event.event_code

  useEffect(() => {
    if (!needsAudioUnlock && selectedLang && !audioUnlocked) {
      setAudioUnlocked(true)
    }
  }, [needsAudioUnlock, selectedLang, audioUnlocked])

  const handleUnlock = useCallback(async () => {
    setAudioUnlocked(true)
    if (playerRef.current) {
      await playerRef.current.unlock()
    } else if (selectedLang) {
      currentLang.current = selectedLang
      await startViewer(selectedLang, viewerMode)
      const p = playerRef.current as AudioPlayer | null
      await p?.unlock()
    }
  }, [selectedLang, startViewer, viewerMode])

  // Connect / reconnect on lang or mode change
  useEffect(() => {
    if (!selectedLang || !audioUnlocked) return
    if (currentLang.current === selectedLang) return
    if (currentLang.current && clientRef.current) {
      clientRef.current.switchLang(selectedLang, viewerMode)
      currentLang.current = selectedLang
      playerRef.current?.flush()
      return
    }
    currentLang.current = selectedLang
    startViewer(selectedLang, viewerMode).catch(console.error)
  }, [selectedLang, audioUnlocked, startViewer, viewerMode])

  // Reconnect poll when broadcast is not yet live
  useEffect(() => {
    if (!broadcastNotLive || !audioUnlocked || !selectedLang) return
    const timer = setTimeout(() => {
      currentLang.current = null
      clientRef.current?.destroy()
      clientRef.current = null
      setBroadcastNotLive(false)
      startViewer(selectedLang, viewerMode).catch(console.error)
    }, 5000)
    return () => clearTimeout(timer)
  }, [broadcastNotLive, audioUnlocked, selectedLang, startViewer, viewerMode])

  useEffect(() => {
    return () => { clientRef.current?.destroy(); playerRef.current?.destroy() }
  }, [])

  // Clear entries/streaming on lang change
  useEffect(() => {
    setEntries([])
    setStreaming(null)
  }, [selectedLang])

  // ── Typewriter ─────────────────────────────────────────────────────────────

  const prevStreamingId = useRef<string | null>(null)
  const [typewriterResetKey, setTypewriterResetKey] = useState(0)

  useEffect(() => {
    if (streaming?.utteranceId && streaming.utteranceId !== prevStreamingId.current) {
      if (prevStreamingId.current !== null) {
        // Utterance boundary — reset so next draft types in fresh
        setTypewriterResetKey(k => k + 1)
      }
      prevStreamingId.current = streaming.utteranceId
    }
    if (!streaming) prevStreamingId.current = null
  }, [streaming?.utteranceId, streaming])

  const lastEntry = entries[entries.length - 1]
  const activeTarget = streaming?.text ?? lastEntry?.text ?? ''
  const displayedText = useTypewriter(activeTarget, typewriterResetKey)

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [displayedText, entries.length])

  // ── Derived ────────────────────────────────────────────────────────────────

  const langName = selectedLang
    ? (LANGUAGES.find(l => l.code === selectedLang)?.name ?? selectedLang.toUpperCase())
    : null

  const isRtl = selectedLang ? isRtlLang(selectedLang) : false
  const isStreaming = streaming !== null
  const isPartial = streaming?.stability === 'partial'
  const hasContent = entries.length > 0 || isStreaming
  const isMinimized = isLive && hasContent
  const isTyping = displayedText !== activeTarget
  // Context entries: 3 before the active one when streaming, 3 before last when not
  const contextEntries = isStreaming ? entries.slice(-3) : entries.slice(-4, -1)

  // ── Audio unsupported reason text ──────────────────────────────────────────

  function audioUnsupportedNote(): string {
    switch (audioSupport.reason) {
      case 'no_audio_decoder': return 'Live audio requires a browser with WebCodecs support (Chrome 94+, Edge 94+).'
      case 'no_audio_context': return 'Live audio requires Web Audio API support.'
      case 'no_audio_worklet': return 'Live audio requires AudioWorklet support.'
      default: return 'Live audio is not supported in this browser. Captions only.'
    }
  }

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
                const name = LANGUAGES.find(l => l.code === code)?.name ?? code.toUpperCase()
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

  // ── Phase: audio tap gate ──────────────────────────────────────────────────

  if (needsAudioUnlock && !audioUnlocked) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
        <div className="mb-8 space-y-3">
          <h1 className="text-2xl font-black tracking-tight">{event.title}</h1>
          <p className="text-black/40 text-sm">
            Translated to{" "}
            <span className="font-bold text-black">{langName}</span>
          </p>
          {!audioSupport.supported && (
            <p className="text-amber-600 text-xs mt-2 max-w-xs mx-auto">{audioUnsupportedNote()}</p>
          )}
        </div>
        <button
          onClick={handleUnlock}
          className="w-full max-w-xs py-5 bg-black text-white font-black text-xl rounded-2xl hover:bg-black/80 active:scale-[0.97] transition-all"
        >
          {audioSupport.supported ? 'Tap to listen' : 'Join (captions only)'}
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

      {/* Status bar */}
      <div
        className="flex items-center justify-between px-5 border-b border-black/8 transition-all duration-300 flex-shrink-0"
        style={{ paddingTop: isMinimized ? 5 : 12, paddingBottom: isMinimized ? 5 : 12 }}
      >
        <div className="flex items-center gap-2">
          {isReconnecting ? (
            <span className="text-[10px] font-bold tracking-widest uppercase text-amber-500 animate-pulse">
              Reconnecting…
            </span>
          ) : isLive ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse flex-shrink-0" />
              {!isMinimized && (
                <span className="text-[10px] font-bold tracking-widest uppercase text-black/50">Live</span>
              )}
            </>
          ) : broadcastNotLive ? (
            <span className="text-[10px] font-bold tracking-widest uppercase text-black/20">
              Waiting for broadcast…
            </span>
          ) : (
            <span className="text-[10px] font-bold tracking-widest uppercase text-black/20">Connecting…</span>
          )}
          {event.tts_enabled && audioSupport.supported && audioPlaying && viewerMode !== 'captions_only' && (
            <span className="text-[10px] text-black/30 ml-1">· audio on</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setModePickerOpen(o => !o)}
            className="text-[10px] font-bold border border-black/15 rounded-full px-2 py-1 hover:border-black/40 transition-colors text-black/40"
            title="Viewer mode"
          >
            {MODE_LABEL[viewerMode]}
          </button>
          <button
            onClick={() => setLangPickerOpen(true)}
            className="text-[10px] font-bold border border-black/15 rounded-full px-2.5 py-1 hover:border-black/40 transition-colors text-black/50"
          >
            {langName}
          </button>
        </div>
      </div>

      {/* Mode picker */}
      {modePickerOpen && (
        <div className="flex-shrink-0 flex items-center gap-1.5 px-5 py-2.5 border-b border-black/8 bg-black/[0.02]">
          {VIEWER_MODES.map(m => (
            <button
              key={m}
              onClick={() => {
                setViewerMode(m)
                setModePickerOpen(false)
                // Reconnect with new mode if connected
                if (currentLang.current && clientRef.current) {
                  const lang = currentLang.current
                  currentLang.current = null
                  startViewer(lang, m).catch(console.error)
                }
              }}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-wide transition-colors ${
                m === viewerMode
                  ? 'bg-black text-white'
                  : 'bg-black/5 text-black/50 hover:bg-black/10'
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable caption area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col justify-end px-5 pb-10 pt-8 gap-4">

          {!hasContent && !broadcastNotLive && (
            <p className="text-center text-black/20 text-sm font-medium">
              Waiting for the broadcast to start
            </p>
          )}

          {broadcastNotLive && !hasContent && (
            <p className="text-center text-black/20 text-sm font-medium">
              The broadcast hasn't started yet — will connect automatically
            </p>
          )}

          {/* Fading committed context entries */}
          {contextEntries.map((entry, i) => {
            const fromEnd = contextEntries.length - 1 - i
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

          {/* Active text — typewriter animated */}
          {(displayedText.length > 0 || isStreaming) && (
            <p
              className={`text-[clamp(1.4rem,5.5vw,2.1rem)] leading-snug font-semibold ${
                isPartial ? 'text-black/50 italic' : 'text-black'
              }`}
              dir={isRtl ? 'rtl' : 'ltr'}
              style={{ textAlign: isRtl ? 'right' : 'left', transition: 'color 0.2s ease' }}
            >
              {displayedText}
              {(isStreaming || isTyping) && (
                <span className="text-black/25 animate-pulse"> ▍</span>
              )}
            </p>
          )}

        </div>
      </div>

      {/* Audio-unsupported notice (bottom, non-intrusive) */}
      {event.tts_enabled && !audioSupport.supported && (
        <div className="flex-shrink-0 px-5 py-2 text-center border-t border-black/5">
          <p className="text-[10px] text-black/25">{audioUnsupportedNote()}</p>
        </div>
      )}
    </div>
  )
}
