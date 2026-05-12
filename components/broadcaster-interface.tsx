"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Copy, Check, ExternalLink, Mic, MicOff,
  AlertCircle, Languages, Save, Wifi, WifiOff,
  Headphones, Users, ChevronDown, Pause, Play,
  Download, Plus, Trash2, ArrowLeft, Globe,
  BookOpen, StickyNote, Radio, Lock, Unlock,
  BookMarked,
} from "lucide-react";
import Link from "next/link";
import { useScribe } from "@elevenlabs/react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LanguageSelector } from "@/components/language-selector";
import { KnowledgePanel } from "@/components/knowledge-panel";
import { WorkerClient } from "@/lib/worker-client";
import type { EventKnowledge } from "@/lib/worker-types";
import { EventQR } from "@/components/event-qr";
import { LANGUAGES } from "@/lib/languages";
import { LatencySparkline } from "@/components/latency-sparkline";
import { PreBroadcastChecklist } from "@/components/pre-broadcast-checklist";
import { downloadAllSRT, type TranscriptEntry } from "@/lib/export-srt";

interface Event {
  id: string; uid: string; title: string; description: string | null;
  event_code: string | null; source_language: string; target_languages: string[];
  tts_enabled: boolean;
  knowledge_domain: string | null; knowledge_subdomain: string | null;
  knowledge_specialty: string | null; knowledge_briefing: string | null;
  knowledge_keyterms: string[] | null;
  knowledge_term_translations: Record<string, Record<string, string>> | null;
  organization: string | null;
  glossary?: Record<string, string> | null;
}

interface BroadcasterInterfaceProps { event: Event; viewerUrl: string; }
interface Caption { id: string; text: string; timestamp: string; is_final: boolean; language_code?: string; }
interface TranslatedLine { text: string; ts: number; }

interface LanguageDetectorMonitor {
  addEventListener(type: "downloadprogress", listener: (e: { loaded: number; total: number }) => void): void;
  removeEventListener(type: "downloadprogress", listener: (e: { loaded: number; total: number }) => void): void;
}
interface LanguageDetector { detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>; }
interface LanguageDetectorConstructor {
  create(options?: { monitor?: (m: LanguageDetectorMonitor) => void }): Promise<LanguageDetector>;
  availability(): Promise<string>;
}
declare global { interface Window { LanguageDetector?: LanguageDetectorConstructor; } }

type NavSection = "setup" | "knowledge" | "notes" | "monitor";
type KnowledgeTab = "knowledge" | "glossary";

const MAX_MONITOR_LINES = 8;
const MAX_LATENCY_POINTS = 60;

function langName(code: string) {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

// ── Health dot ────────────────────────────────────────────────────────────────
function HealthDot({ lastAt, active }: { lastAt: number | null; active: boolean }) {
  const age = lastAt ? Date.now() - lastAt : Infinity;
  if (!active) return <span className="w-1.5 h-1.5 rounded-full bg-white/20 inline-block" />;
  if (age < 30_000) return <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />;
  if (age < 60_000) return <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />;
}

// ── Nav item ──────────────────────────────────────────────────────────────────
function NavItem({
  icon, label, badge, active, dimmed = false, onClick,
}: {
  icon: React.ReactNode; label: string; badge?: string;
  active: boolean; dimmed?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors relative"
      style={{
        background: active ? "rgba(255,255,255,0.07)" : "transparent",
        color: active
          ? "rgba(255,255,255,0.85)"
          : dimmed
            ? "rgba(255,255,255,0.22)"
            : "rgba(255,255,255,0.42)",
      }}
    >
      {active && (
        <span
          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full"
          style={{ background: "rgba(255,255,255,0.45)" }}
        />
      )}
      <span className="shrink-0">{icon}</span>
      <span className="text-xs font-medium flex-1">{label}</span>
      {badge && (
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded-full shrink-0"
          style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Translation feed column ───────────────────────────────────────────────────
function LangFeed({
  lang, lines, lastAt, listenerCount, isRecording, paused, onTogglePause, latency,
}: {
  lang: string; lines: TranslatedLine[]; lastAt: number | null; listenerCount: number;
  isRecording: boolean; paused: boolean; onTogglePause: () => void; latency: number[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  const age = lastAt ? Date.now() - lastAt : null;
  const latencyLabel = age !== null ? (age < 60_000 ? `${(age / 1000).toFixed(0)}s` : ">60s") : "—";

  return (
    <div
      className="flex flex-col min-w-[200px] flex-1 rounded-xl overflow-hidden transition-colors"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: paused ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.03)" }}>
        <div className="flex items-center gap-2">
          <HealthDot lastAt={lastAt} active={isRecording && !paused} />
          <span className="font-bold text-[11px] tracking-widest text-white/80">{lang.toUpperCase()}</span>
          <span className="text-[10px] text-white/25">{langName(lang)}</span>
          {paused && <span className="text-[10px] text-amber-400/70">paused</span>}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-white/30">
          <span>{latencyLabel}</span>
          {listenerCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Headphones className="h-2.5 w-2.5" />
              {listenerCount}
            </span>
          )}
          {isRecording && (
            <button
              onClick={onTogglePause}
              className="text-white/30 hover:text-white/60 transition-colors p-0.5"
              title={paused ? "Resume translation" : "Pause translation"}
            >
              {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[160px] max-h-[240px]">
        {lines.length === 0 ? (
          <p className="text-white/20 text-xs italic">Waiting for translations…</p>
        ) : (
          lines.map((l, i) => (
            <p key={i} className={`text-sm leading-snug ${i === lines.length - 1 ? "text-white/90" : "text-white/35"}`}>
              {l.text}
            </p>
          ))
        )}
      </div>
      {latency.length > 1 && (
        <div className="px-3 pb-2">
          <LatencySparkline data={latency} width={120} height={20} />
        </div>
      )}
    </div>
  );
}

// ── Source feed ───────────────────────────────────────────────────────────────
function SourceFeed({ captions, partialText, detectedLang }: {
  captions: Caption[]; partialText: string; detectedLang: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [captions, partialText]);

  return (
    <div
      className="flex flex-col min-w-[200px] flex-1 rounded-xl overflow-hidden"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.03)" }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-white/40 inline-block" />
          <span className="font-bold text-[11px] tracking-widest text-white/70">SOURCE</span>
        </div>
        {detectedLang && (
          <span className="text-[10px] text-white/30 flex items-center gap-1">
            <Languages className="h-2.5 w-2.5" />
            {detectedLang.toUpperCase()}
          </span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[160px] max-h-[240px]">
        {captions.length === 0 && !partialText && (
          <p className="text-white/20 text-xs italic">Waiting for speech…</p>
        )}
        {captions.slice(-MAX_MONITOR_LINES).map((c) => (
          <p key={c.id} className="text-sm leading-snug text-white/40">{c.text}</p>
        ))}
        {partialText && (
          <p className="text-sm leading-snug text-white/85 italic">
            {partialText}<span className="animate-pulse">▍</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Device picker ─────────────────────────────────────────────────────────────
function DevicePicker({
  devices, value, onChange, disabled,
}: { devices: MediaDeviceInfo[]; value: string; onChange: (v: string) => void; disabled: boolean }) {
  if (devices.length === 0) return null;
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none rounded-lg px-3 py-2 pr-7 text-xs disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none truncate"
        style={{
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.75)",
        }}
      >
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId} style={{ background: "#0b0d16" }}>
            {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-white/25 pointer-events-none" />
    </div>
  );
}

// ── Hold-to-unlock lock button ────────────────────────────────────────────────
const HOLD_MS = 3000;
const LOCK_RADIUS = 15;
const LOCK_CIRC = 2 * Math.PI * LOCK_RADIUS;

function HoldLockButton({
  locked, onUnlock, onLock,
}: { locked: boolean; onUnlock: () => void; onLock: () => void }) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const startHold = useCallback(() => {
    if (!locked) { onLock(); return; }
    startRef.current = Date.now();
    const tick = () => {
      const p = Math.min((Date.now() - startRef.current) / HOLD_MS, 1);
      setProgress(p);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        onUnlock();
        setProgress(0);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [locked, onLock, onUnlock]);

  const cancelHold = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setProgress(0);
  }, []);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <button
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={(e) => { e.preventDefault(); startHold(); }}
      onTouchEnd={cancelHold}
      onTouchCancel={cancelHold}
      className="relative w-10 h-10 flex items-center justify-center rounded-xl shrink-0 transition-colors"
      style={{
        background: locked ? "rgba(255,255,255,0.05)" : "rgba(245,158,11,0.12)",
        border: locked ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(245,158,11,0.35)",
        color: locked ? "rgba(255,255,255,0.4)" : "rgba(245,158,11,0.85)",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
      title={locked ? "Hold 3s to unlock mic switching" : "Click to lock"}
    >
      {progress > 0 && (
        <svg className="absolute inset-0 -rotate-90" width="40" height="40" viewBox="0 0 40 40">
          <circle
            cx="20" cy="20" r={LOCK_RADIUS}
            fill="none"
            stroke="rgba(245,158,11,0.75)"
            strokeWidth="2.5"
            strokeDasharray={LOCK_CIRC}
            strokeDashoffset={LOCK_CIRC * (1 - progress)}
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className="relative z-10">
        {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
      </span>
    </button>
  );
}

// ── Glossary panel ────────────────────────────────────────────────────────────
function GlossaryPanel({
  glossary, onChange,
}: { glossary: Record<string, string>; onChange: (g: Record<string, string>) => void }) {
  const entries = Object.entries(glossary);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  const addRow = () => {
    const k = newKey.trim(); const v = newVal.trim();
    if (!k || !v) return;
    onChange({ ...glossary, [k]: v });
    setNewKey(""); setNewVal("");
  };

  const inputCls = "flex-1 min-w-0 rounded px-2 py-1 text-xs focus:outline-none";
  const inputStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "rgba(255,255,255,0.8)",
  };

  return (
    <div className="space-y-2">
      {entries.length === 0 && (
        <p className="text-[11px] text-white/25 italic">No terms yet.</p>
      )}
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-xs text-white/60 flex-1 truncate font-mono">{k}</span>
          <span className="text-[10px] text-white/25">→</span>
          <span className="text-xs text-white/60 flex-1 truncate font-mono">{v}</span>
          <button onClick={() => { const n = { ...glossary }; delete n[k]; onChange(n); }} className="text-white/20 hover:text-red-400 transition-colors">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5 pt-1">
        <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="Term"
          className={inputCls} style={inputStyle}
          onKeyDown={(e) => { if (e.key === "Enter") addRow(); }} />
        <span className="text-[10px] text-white/25">→</span>
        <input value={newVal} onChange={(e) => setNewVal(e.target.value)} placeholder="Translation"
          className={inputCls} style={inputStyle}
          onKeyDown={(e) => { if (e.key === "Enter") addRow(); }} />
        <button onClick={addRow} className="text-white/35 hover:text-white transition-colors shrink-0">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
function Divider() {
  return <div className="w-full h-px my-1" style={{ background: "rgba(255,255,255,0.06)" }} />;
}

// ── Main component ────────────────────────────────────────────────────────────
export function BroadcasterInterface({ event, viewerUrl }: BroadcasterInterfaceProps) {
  const [copied, setCopied] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [partialText, setPartialText] = useState("");
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [selectedSourceLang, setSelectedSourceLang] = useState<string | null>(
    event.source_language === "auto" ? null : event.source_language
  );
  const [targetLangs, setTargetLangs] = useState<string[]>(event.target_languages ?? []);
  const [listenerCounts, setListenerCounts] = useState<Record<string, number>>({});
  const [workerConnected, setWorkerConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [knowledge, setKnowledge] = useState<EventKnowledge>({
    domain: event.knowledge_domain ?? "",
    subdomain: event.knowledge_subdomain ?? "",
    specialty: event.knowledge_specialty ?? "",
    briefing: event.knowledge_briefing ?? "",
    keyterms: event.knowledge_keyterms ?? [],
    termTranslations: event.knowledge_term_translations ?? {},
  });
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [translatedFeeds, setTranslatedFeeds] = useState<Record<string, TranslatedLine[]>>({});
  const [lastTranslationAt, setLastTranslationAt] = useState<Record<string, number>>({});
  const [committedCount, setCommittedCount] = useState(0);
  const [pausedLangs, setPausedLangs] = useState<Set<string>>(new Set());
  const [glossary, setGlossary] = useState<Record<string, string>>(
    (event.glossary as Record<string, string> | null | undefined) ?? {}
  );
  const [latencyHistory, setLatencyHistory] = useState<Record<string, number[]>>({});
  const [presenterNotes, setPresenterNotes] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(`babel-notes-${event.id}`) ?? "";
  });
  const [showChecklist, setShowChecklist] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportingTranscripts, setExportingTranscripts] = useState(false);

  // Layout state
  const [activeSection, setActiveSection] = useState<NavSection>("setup");
  const [micPinned, setMicPinned] = useState(false);
  const [knowledgeTab, setKnowledgeTab] = useState<KnowledgeTab>("knowledge");

  const sequenceNumberRef = useRef(0);
  const eventStartRef = useRef<number>(0);
  const workerClientRef = useRef<WorkerClient | null>(null);
  const supabase = getSupabaseBrowserClient();
  const broadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const languageDetectorRef = useRef<LanguageDetector | null>(null);

  const detectLanguage = useCallback(async (text: string): Promise<string | null> => {
    if (!languageDetectorRef.current || text.length < 10) return null;
    try {
      const results = await languageDetectorRef.current.detect(text);
      const top = results[0];
      if (top && top.confidence > 0.5) return top.detectedLanguage;
    } catch { /* ignore */ }
    return null;
  }, []);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((devices) => {
        const inputs = devices.filter((d) => d.kind === "audioinput");
        setAudioDevices(inputs);
        if (inputs.length > 0 && !selectedDeviceId) setSelectedDeviceId(inputs[0]!.deviceId);
      })
      .catch(() => setError("Failed to access microphone. Please grant permission."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("LanguageDetector" in window)) return;
    window.LanguageDetector!.create().then((d) => { languageDetectorRef.current = d; }).catch(() => {});
  }, []);

  useEffect(() => { workerClientRef.current?.updateTargets(targetLangs); }, [targetLangs]);
  useEffect(() => { workerClientRef.current?.updateGlossary(glossary); }, [glossary]);

  const handlePresenterNotesChange = useCallback((val: string) => {
    setPresenterNotes(val);
    try { localStorage.setItem(`babel-notes-${event.id}`, val); } catch { /* ignore */ }
  }, [event.id]);

  const addTranslatedLine = useCallback((lang: string, text: string, sentAt?: number) => {
    if (!text.trim()) return;
    const now = Date.now();
    setTranslatedFeeds((prev) => {
      const existing = prev[lang] ?? [];
      return { ...prev, [lang]: [...existing, { text, ts: now }].slice(-MAX_MONITOR_LINES) };
    });
    setLastTranslationAt((prev) => ({ ...prev, [lang]: now }));
    if (sentAt && sentAt > 0) {
      setLatencyHistory((prev) => {
        const existing = prev[lang] ?? [];
        return { ...prev, [lang]: [...existing, now - sentAt].slice(-MAX_LATENCY_POINTS) };
      });
    }
  }, []);

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    onPartialTranscript: async (data) => {
      setPartialText(data.text);
      const detectedLang = await detectLanguage(data.text);
      if (detectedLang) setDetectedLanguage(detectedLang);
      broadcastChannelRef.current?.send({
        type: "broadcast", event: "partial_transcript",
        payload: { text: data.text, language_code: detectedLang },
      });
    },
    onCommittedTranscript: async (data) => {
      setPartialText("");
      setCommittedCount((n) => n + 1);
      const detectedLang = await detectLanguage(data.text);
      if (detectedLang) setDetectedLanguage(detectedLang);
      const langCode = detectedLang ?? selectedSourceLang ?? "source";
      const ts = Date.now() - eventStartRef.current;
      workerClientRef.current?.sendTranscript(langCode, data.text, true, ts);
      try {
        const { data: inserted, error: insertError } = await supabase
          .from("captions")
          .insert({ event_id: event.id, text: data.text, sequence_number: sequenceNumberRef.current++, is_final: true, language_code: langCode })
          .select().single();
        if (!insertError && inserted) setCaptions((prev) => [...prev, inserted as Caption]);
      } catch { /* silent */ }
    },
    onError: (err) => setError(`Transcription error: ${err instanceof Error ? err.message : "Unknown"}`),
  });

  const handleSaveLanguages = async () => {
    setSaving(true); setSaved(false);
    const { error: err } = await supabase.from("events")
      .update({ source_language: selectedSourceLang ?? "auto", target_languages: targetLangs })
      .eq("id", event.id);
    setSaving(false);
    if (!err) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const copyViewerLink = () => {
    navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Mid-broadcast mic switch (safety pin)
  const handleDeviceChange = useCallback(async (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    if (!isRecording || !micPinned) return;
    try {
      setError(null);
      scribe.disconnect();
      const res = await fetch(`/api/scribe-token?eventUid=${event.uid}`);
      if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? "Token error"); }
      const { token } = await res.json() as { token: string };
      await scribe.connect({
        token,
        microphone: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          deviceId: newDeviceId,
        },
        ...(selectedSourceLang ? { languageCode: selectedSourceLang } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch microphone");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, micPinned, event.uid, selectedSourceLang]);

  const handleStartRecording = async () => {
    setShowChecklist(false);
    try {
      setError(null);
      eventStartRef.current = Date.now();
      setCommittedCount(0);
      setTranslatedFeeds({});
      setLastTranslationAt({});
      setLatencyHistory({});
      setPausedLangs(new Set());
      setShowExport(false);
      setActiveSection("monitor");

      const worker = new WorkerClient({
        onReady: () => setWorkerConnected(true),
        onTranscript: (lang, text, _final, _ts, sentAt) => addTranslatedLine(lang, text, sentAt),
        onListenerStats: (counts) => setListenerCounts(counts),
        onError: (code, message) => console.error(`[worker] ${code}: ${message}`),
        onDisconnected: () => setWorkerConnected(false),
      });
      worker.connect(event.id, selectedSourceLang ?? "auto", targetLangs, knowledge);
      worker.updateGlossary(glossary);
      workerClientRef.current = worker;

      const res = await fetch(`/api/scribe-token?eventUid=${event.uid}`);
      if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? "Token error"); }
      const { token } = await res.json() as { token: string };

      await scribe.connect({
        token,
        microphone: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          ...(selectedDeviceId ? { deviceId: selectedDeviceId } : {}),
        },
        ...(selectedSourceLang ? { languageCode: selectedSourceLang } : {}),
      });
      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start recording");
    }
  };

  const handleStopRecording = () => {
    scribe.disconnect();
    workerClientRef.current?.end();
    workerClientRef.current = null;
    setIsRecording(false);
    setPartialText("");
    setWorkerConnected(false);
    setShowExport(true);
    setMicPinned(false);
  };

  const handleExportTranscripts = async () => {
    setExportingTranscripts(true);
    try {
      const { data } = await supabase
        .from("transcript_entries")
        .select("language_code, text, timestamp_ms")
        .eq("event_id", event.id)
        .order("timestamp_ms", { ascending: true });
      if (data && data.length > 0) downloadAllSRT(data as TranscriptEntry[], targetLangs, event.title);
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      setExportingTranscripts(false);
    }
  };

  const handleTogglePauseLang = useCallback((lang: string) => {
    setPausedLangs((prev) => {
      const next = new Set(prev);
      if (next.has(lang)) { next.delete(lang); workerClientRef.current?.resumeLang(lang); }
      else { next.add(lang); workerClientRef.current?.pauseLang(lang); }
      return next;
    });
  }, []);

  useEffect(() => () => { workerClientRef.current?.destroy(); }, []);

  useEffect(() => {
    supabase.from("captions").select("*").eq("event_id", event.id).eq("is_final", true)
      .order("sequence_number", { ascending: true })
      .then(({ data }: { data: Caption[] | null }) => {
        if (data) { setCaptions(data); sequenceNumberRef.current = data.length; }
      });
  }, [event.id, supabase]);

  useEffect(() => {
    const channel = supabase.channel(`captions:${event.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "captions", filter: `event_id=eq.${event.id}` },
        (payload: { new: Caption }) => {
          setCaptions((prev) => prev.some((c) => c.id === payload.new.id) ? prev : [...prev, payload.new]);
        })
      .subscribe();
    const broadcastChannel = supabase.channel(`broadcast:${event.uid}`).subscribe();
    broadcastChannelRef.current = broadcastChannel;
    return () => { supabase.removeChannel(channel); supabase.removeChannel(broadcastChannel); broadcastChannelRef.current = null; };
  }, [event.id, event.uid, supabase]);

  const totalListeners = Object.values(listenerCounts).reduce((s, n) => s + n, 0);
  const selectedDeviceLabel = audioDevices.find((d) => d.deviceId === selectedDeviceId)?.label ?? "No mic";
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL ?? "";
  const checklistChecks = { micSelected: !!selectedDeviceId, targetLangs: targetLangs.length > 0, workerUrl: !!workerUrl };

  const iconBtn = "w-7 h-7 flex items-center justify-center rounded-md transition-colors text-white/35 hover:text-white/70 hover:bg-white/[0.06]";

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "#07090e", color: "rgba(255,255,255,0.85)" }}>

      <PreBroadcastChecklist
        open={showChecklist}
        onClose={() => setShowChecklist(false)}
        onConfirm={handleStartRecording}
        checks={checklistChecks}
      />

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header
        className="h-12 shrink-0 flex items-center gap-3 px-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.35)" }}
      >
        {/* Brand */}
        <span className="font-black text-sm tracking-[0.2em] text-white shrink-0">BABEL</span>
        <span style={{ color: "rgba(255,255,255,0.1)" }} className="text-base leading-none select-none">·</span>

        {/* Event info */}
        <h1 className="font-semibold text-sm truncate max-w-[200px]" style={{ color: "rgba(255,255,255,0.65)" }}>
          {event.title}
        </h1>
        {event.event_code && (
          <span
            className="font-mono text-[10px] tracking-widest shrink-0 px-1.5 py-0.5 rounded"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.28)" }}
          >
            {event.event_code}
          </span>
        )}

        {/* LIVE badge */}
        {isRecording && (
          <div
            className="flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-full"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.22)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            <span className="text-[10px] font-bold tracking-widest text-red-400">LIVE</span>
          </div>
        )}

        <div className="flex-1 min-w-0" />

        {/* Detected language */}
        {isRecording && detectedLanguage && (
          <Badge className="bg-white/[0.08] text-white/50 gap-1.5 text-[10px] border-white/10 shrink-0">
            <Languages className="h-2.5 w-2.5" />
            {detectedLanguage.toUpperCase()}
          </Badge>
        )}

        {/* Viewer URL strip */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          <div
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-mono truncate max-w-[210px]"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
              color: "rgba(255,255,255,0.28)",
            }}
          >
            {viewerUrl}
          </div>
          <button onClick={copyViewerLink} className={iconBtn} title="Copy viewer link">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <Link href={`/v/${event.event_code}`} target="_blank" className={iconBtn} title="Open viewer">
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          {event.event_code && (
            <div className={`[&_button]:${iconBtn} [&_.absolute]:bg-[#0b0d18] [&_.absolute]:border-white/10`}>
              <EventQR url={viewerUrl} eventCode={event.event_code} eventTitle={event.title} />
            </div>
          )}
        </div>

        <div className="w-px h-5 shrink-0 mx-1" style={{ background: "rgba(255,255,255,0.08)" }} />

        {/* Connection status */}
        <div className="flex items-center gap-3 shrink-0">
          <span className={`flex items-center gap-1.5 text-[10px] font-medium ${workerConnected ? "text-emerald-400" : "text-white/20"}`}>
            {workerConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            Worker
          </span>
          <span className={`flex items-center gap-1.5 text-[10px] font-medium ${scribe.isConnected ? "text-emerald-400" : "text-white/20"}`}>
            <Mic className="h-3 w-3" />
            Scribe
          </span>
        </div>

        <div className="w-px h-5 shrink-0 mx-1" style={{ background: "rgba(255,255,255,0.08)" }} />

        {/* Export (post-broadcast) */}
        {showExport && !isRecording && (
          <button
            onClick={handleExportTranscripts}
            disabled={exportingTranscripts}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-colors shrink-0 hover:bg-white/[0.05]"
            style={{ color: "rgba(255,255,255,0.38)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <Download className="h-3.5 w-3.5" />
            {exportingTranscripts ? "Exporting…" : "Export SRT"}
          </button>
        )}

        {/* ── CTA ── */}
        {!isRecording ? (
          <button
            onClick={() => setShowChecklist(true)}
            disabled={scribe.isConnected || !selectedDeviceId}
            className="h-8 flex items-center gap-1.5 px-4 rounded-lg font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] shrink-0"
            style={{ background: "white", color: "black" }}
          >
            <Mic className="h-3.5 w-3.5" />
            Go Live
          </button>
        ) : (
          <button
            onClick={handleStopRecording}
            className="h-8 flex items-center gap-1.5 px-4 rounded-lg font-bold text-sm transition-all active:scale-[0.98] shrink-0"
            style={{ background: "#dc2626", color: "white" }}
          >
            <MicOff className="h-3.5 w-3.5" />
            End Broadcast
          </button>
        )}

        <div className="w-px h-5 shrink-0 mx-1" style={{ background: "rgba(255,255,255,0.08)" }} />

        {/* Dashboard */}
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-[11px] rounded-md px-2 py-1 transition-colors shrink-0 hover:bg-white/[0.05]"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          <ArrowLeft className="h-3 w-3" />
          Dashboard
        </Link>
      </header>

      {/* ── BODY ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">

        {/* ── NAV SIDEBAR ──────────────────────────────────────────────────── */}
        <nav
          className="w-48 shrink-0 flex flex-col py-2 overflow-y-auto"
          style={{ background: "#0b0d17", borderRight: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* PRE-EVENT group */}
          <div className="px-4 pt-3 pb-1.5">
            <span
              className="text-[9px] font-bold tracking-[0.22em] uppercase transition-colors"
              style={{ color: isRecording ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.25)" }}
            >
              Pre-Event
            </span>
          </div>

          <NavItem
            icon={<Mic className="h-3.5 w-3.5" />}
            label="Setup"
            active={activeSection === "setup"}
            dimmed={isRecording}
            onClick={() => setActiveSection("setup")}
          />
          <NavItem
            icon={<BookOpen className="h-3.5 w-3.5" />}
            label="Knowledge"
            badge={knowledge.keyterms.length > 0 ? `${knowledge.keyterms.length}` : undefined}
            active={activeSection === "knowledge"}
            dimmed={isRecording}
            onClick={() => setActiveSection("knowledge")}
          />
          <NavItem
            icon={<StickyNote className="h-3.5 w-3.5" />}
            label="Notes"
            active={activeSection === "notes"}
            dimmed={isRecording}
            onClick={() => setActiveSection("notes")}
          />

          {/* LIVE group */}
          <div className="px-4 pt-5 pb-1.5 flex items-center gap-2">
            <span className="text-[9px] font-bold tracking-[0.22em] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>
              Live
            </span>
            {isRecording && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />}
          </div>

          <NavItem
            icon={<Radio className="h-3.5 w-3.5" />}
            label="Monitor"
            badge={totalListeners > 0 ? `${totalListeners}` : undefined}
            active={activeSection === "monitor"}
            onClick={() => setActiveSection("monitor")}
          />

          <div className="flex-1" />
        </nav>

        {/* ── MAIN ─────────────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 overflow-y-auto" style={{ background: "#07090e" }}>

          {error && (
            <div className="mx-6 mt-6">
              <Alert variant="destructive" className="bg-red-950/40 border-red-800/40 text-red-300">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}

          {/* ── SETUP ── */}
          {activeSection === "setup" && (
            <div className="p-8 max-w-2xl space-y-4">

              {/* Microphone */}
              <div
                className="rounded-2xl p-6 space-y-4"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5 min-w-0 pr-4">
                    <p className="text-[11px] font-semibold tracking-[0.18em] uppercase" style={{ color: "rgba(255,255,255,0.28)" }}>
                      Microphone
                    </p>
                    <p className="text-lg font-semibold text-white leading-tight truncate">{selectedDeviceLabel}</p>
                  </div>
                  <HoldLockButton
                    locked={!micPinned}
                    onUnlock={() => setMicPinned(true)}
                    onLock={() => setMicPinned(false)}
                  />
                </div>
                <DevicePicker
                  devices={audioDevices}
                  value={selectedDeviceId}
                  onChange={handleDeviceChange}
                  disabled={isRecording && !micPinned}
                />
                {isRecording && (
                  <div className="flex items-center gap-2.5 pt-1">
                    <div className="flex gap-[3px] items-end">
                      {[...Array(5)].map((_, i) => (
                        <span
                          key={i}
                          className={`inline-block w-[3px] rounded-sm bg-emerald-400 ${partialText ? "animate-pulse" : "opacity-20"}`}
                          style={{ height: `${8 + i * 3}px`, animationDelay: `${i * 80}ms` }}
                        />
                      ))}
                    </div>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {partialText ? "Picking up audio" : "Listening…"}
                    </span>
                    <span className="ml-auto text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
                      {committedCount} segments
                    </span>
                  </div>
                )}
                {micPinned && isRecording && (
                  <p className="text-xs" style={{ color: "rgba(245,158,11,0.65)" }}>
                    Switching will briefly interrupt transcription
                  </p>
                )}
                {!micPinned && (
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.18)" }}>
                    Hold the lock for 3s to allow switching while live
                  </p>
                )}
              </div>

              {/* Source Language */}
              <div
                className="rounded-2xl p-6 space-y-4"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold tracking-[0.18em] uppercase" style={{ color: "rgba(255,255,255,0.28)" }}>
                    Source Language
                  </p>
                  <p className="text-lg font-semibold text-white">
                    {selectedSourceLang ? langName(selectedSourceLang) : "Auto-detect"}
                  </p>
                </div>
                <div className="[&_button]:bg-white/5 [&_button]:border-white/10 [&_button]:text-white/70 [&_button:hover]:bg-white/[0.08]">
                  <LanguageSelector value={selectedSourceLang} onValueChange={setSelectedSourceLang} />
                </div>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
                  Leave blank to auto-detect the speaker's language
                </p>
              </div>

              {/* Translate To */}
              <div
                className="rounded-2xl p-6 space-y-4"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold tracking-[0.18em] uppercase" style={{ color: "rgba(255,255,255,0.28)" }}>
                      Translate To
                    </p>
                    <p className="text-lg font-semibold text-white">
                      {targetLangs.length === 0
                        ? "No languages"
                        : targetLangs.map((l) => langName(l)).join(" · ")}
                    </p>
                  </div>
                  {!isRecording && (
                    <button
                      onClick={handleSaveLanguages}
                      disabled={saving}
                      className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg transition-colors shrink-0"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.45)",
                      }}
                    >
                      {saved ? <Check className="h-3 w-3 text-emerald-400" /> : <Save className="h-3 w-3" />}
                      {saving ? "Saving…" : saved ? "Saved" : "Save"}
                    </button>
                  )}
                </div>

                {targetLangs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {targetLangs.map((lang) => (
                      <button
                        key={lang}
                        onClick={() => !isRecording && setTargetLangs((prev) => prev.filter((l) => l !== lang))}
                        disabled={isRecording}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        style={{
                          background: "rgba(255,255,255,0.07)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "rgba(255,255,255,0.7)",
                        }}
                      >
                        <span className="font-mono">{lang.toUpperCase()}</span>
                        <span className="text-xs font-normal" style={{ color: "rgba(255,255,255,0.35)" }}>{langName(lang)}</span>
                        {!isRecording && <span style={{ color: "rgba(255,255,255,0.25)" }}>×</span>}
                      </button>
                    ))}
                  </div>
                )}

                {!isRecording && (
                  <div className="[&_button]:bg-white/5 [&_button]:border-white/10 [&_button]:text-white/70">
                    <LanguageSelector
                      value={null}
                      onValueChange={(lang) => { if (lang && !targetLangs.includes(lang)) setTargetLangs((prev) => [...prev, lang]); }}
                      defaultOption={{ value: null, label: "Add language…" }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── KNOWLEDGE + GLOSSARY ── */}
          {activeSection === "knowledge" && (
            <div className="dark p-6">
              {/* Tabs */}
              <div
                className="flex items-center gap-0 mb-6"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
              >
                <button
                  onClick={() => setKnowledgeTab("knowledge")}
                  className="flex items-center gap-2 text-xs px-4 py-2.5 transition-colors"
                  style={{
                    borderBottom: knowledgeTab === "knowledge" ? "2px solid rgba(255,255,255,0.6)" : "2px solid transparent",
                    color: knowledgeTab === "knowledge" ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
                    marginBottom: "-1px",
                  }}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Knowledge Base
                  {knowledge.keyterms.length > 0 && (
                    <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {knowledge.keyterms.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setKnowledgeTab("glossary")}
                  className="flex items-center gap-2 text-xs px-4 py-2.5 transition-colors"
                  style={{
                    borderBottom: knowledgeTab === "glossary" ? "2px solid rgba(255,255,255,0.6)" : "2px solid transparent",
                    color: knowledgeTab === "glossary" ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
                    marginBottom: "-1px",
                  }}
                >
                  <BookMarked className="h-3.5 w-3.5" />
                  Glossary
                  {Object.keys(glossary).length > 0 && (
                    <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {Object.keys(glossary).length}
                    </span>
                  )}
                </button>
              </div>

              {knowledgeTab === "knowledge" && (
                <div className="[&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_textarea]:bg-white/5 [&_textarea]:border-white/10 [&_textarea]:text-white [&_label]:text-white/45 [&_.separator]:bg-white/[0.07] [&_[role=separator]]:bg-white/[0.07]">
                  <KnowledgePanel
                    eventId={event.id}
                    eventTitle={event.title}
                    initial={knowledge}
                    organization={event.organization ?? ""}
                    targetLangs={targetLangs}
                    onChange={setKnowledge}
                    defaultOpen
                  />
                </div>
              )}

              {knowledgeTab === "glossary" && (
                <div className="max-w-xl space-y-4">
                  <p className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>
                    Translation Overrides
                  </p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                    Force specific translations for words or phrases. Applied before AI translation.
                  </p>
                  <GlossaryPanel glossary={glossary} onChange={setGlossary} />
                </div>
              )}
            </div>
          )}

          {/* ── NOTES ── */}
          {activeSection === "notes" && (
            <div className="p-6 max-w-2xl">
              <p className="text-[10px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "rgba(255,255,255,0.25)" }}>
                Presenter Notes
              </p>
              <textarea
                value={presenterNotes}
                onChange={(e) => handlePresenterNotesChange(e.target.value)}
                placeholder="Notes for yourself… (auto-saved)"
                className="w-full rounded-xl px-4 py-3 text-sm resize-none focus:outline-none placeholder:opacity-30"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.75)",
                  caretColor: "white",
                  minHeight: "420px",
                }}
              />
            </div>
          )}

          {/* ── MONITOR ── */}
          {activeSection === "monitor" && (
            <div className="p-5 space-y-6">

              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "rgba(255,255,255,0.18)" }}>
                  Live Monitor
                </p>
                {committedCount > 0 && (
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                    {committedCount} segments
                  </span>
                )}
              </div>

              {/* Translation feeds */}
              <div
                className="flex gap-3 overflow-x-auto pb-1"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}
              >
                <SourceFeed captions={captions} partialText={partialText} detectedLang={detectedLanguage} />
                {targetLangs.map((lang) => (
                  <LangFeed
                    key={lang}
                    lang={lang}
                    lines={translatedFeeds[lang] ?? []}
                    lastAt={lastTranslationAt[lang] ?? null}
                    listenerCount={listenerCounts[lang] ?? 0}
                    isRecording={isRecording}
                    paused={pausedLangs.has(lang)}
                    onTogglePause={() => handleTogglePauseLang(lang)}
                    latency={latencyHistory[lang] ?? []}
                  />
                ))}
              </div>

              {/* Audience */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "rgba(255,255,255,0.18)" }}>
                    Audience
                  </p>
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                    <span className="font-black text-lg leading-none text-white">{totalListeners}</span>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>connected</span>
                  </div>
                </div>

                {Object.keys(listenerCounts).length === 0 ? (
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
                    No viewers yet — share the QR code or link above
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                    {Object.entries(listenerCounts).map(([lang, count]) => (
                      <div
                        key={lang}
                        className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                      >
                        <div>
                          <p className="font-semibold text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{langName(lang)}</p>
                          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{lang.toUpperCase()}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-xl text-white leading-none">{count}</p>
                          <div className="flex justify-end mt-1">
                            <HealthDot lastAt={lastTranslationAt[lang] ?? null} active={isRecording} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active mic reminder */}
              {isRecording && (
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.28)" }}
                >
                  <Mic className="h-3 w-3 shrink-0" />
                  <span className="truncate">{selectedDeviceLabel}</span>
                </div>
              )}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
