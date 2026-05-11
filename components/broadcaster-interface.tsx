"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Copy,
  Check,
  ExternalLink,
  Radio,
  Mic,
  MicOff,
  AlertCircle,
  Languages,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useScribe } from "@elevenlabs/react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LanguageSelector } from "@/components/language-selector";
import { WorkerClient } from "@/lib/worker-client";

interface Event {
  id: string;
  uid: string;
  title: string;
  description: string | null;
  event_code: string | null;
  source_language: string;
  target_languages: string[];
  tts_enabled: boolean;
}

interface BroadcasterInterfaceProps {
  event: Event;
  viewerUrl: string;
}

interface Caption {
  id: string;
  text: string;
  timestamp: string;
  is_final: boolean;
  language_code?: string;
}

// Chrome Language Detector API typings
interface LanguageDetectorMonitor {
  addEventListener(type: "downloadprogress", listener: (event: { loaded: number; total: number }) => void): void;
  removeEventListener(type: "downloadprogress", listener: (event: { loaded: number; total: number }) => void): void;
}
interface LanguageDetector {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
}
interface LanguageDetectorConstructor {
  create(options?: { monitor?: (m: LanguageDetectorMonitor) => void }): Promise<LanguageDetector>;
  availability(): Promise<string>;
}
declare global {
  interface Window { LanguageDetector?: LanguageDetectorConstructor; }
}

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

  const sequenceNumberRef = useRef(0);
  const eventStartRef = useRef<number>(0);
  const workerClientRef = useRef<WorkerClient | null>(null);
  const supabase = getSupabaseBrowserClient();
  const broadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
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

  // Enumerate audio devices
  useEffect(() => {
    const getAudioDevices = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === "audioinput");
        setAudioDevices(inputs);
        if (inputs.length > 0 && !selectedDeviceId) setSelectedDeviceId(inputs[0]!.deviceId);
      } catch {
        setError("Failed to access microphone. Please grant permission.");
      }
    };
    getAudioDevices();
  }, [selectedDeviceId]);

  // Initialize Chrome Language Detector
  useEffect(() => {
    if (typeof window === "undefined" || !("LanguageDetector" in window)) return;
    window.LanguageDetector!.create().then((d) => {
      languageDetectorRef.current = d;
    }).catch(() => { /* not available */ });
  }, []);

  // Keep target languages in sync with worker
  useEffect(() => {
    workerClientRef.current?.updateTargets(targetLangs);
  }, [targetLangs]);

  const scribe = useScribe({
    modelId: "scribe_realtime_v2",
    onPartialTranscript: async (data) => {
      setPartialText(data.text);
      const detectedLang = await detectLanguage(data.text);
      if (detectedLang) setDetectedLanguage(detectedLang);
      const langCode = detectedLang ?? (data as { language_code?: string }).language_code;
      broadcastChannelRef.current?.send({
        type: "broadcast",
        event: "partial_transcript",
        payload: { text: data.text, language_code: langCode },
      });
    },
    onFinalTranscript: async (data) => {
      setPartialText("");
      const detectedLang = await detectLanguage(data.text);
      if (detectedLang) setDetectedLanguage(detectedLang);
      const langCode = detectedLang ?? (data as { language_code?: string }).language_code ?? "source";
      const ts = Date.now() - eventStartRef.current;

      // Forward to worker (translation pipeline in Phase 2)
      workerClientRef.current?.sendTranscript(langCode, data.text, true, ts);

      // Persist to captions table (existing viewer experience)
      try {
        const { data: inserted, error: insertError } = await supabase
          .from("captions")
          .insert({
            event_id: event.id,
            text: data.text,
            sequence_number: sequenceNumberRef.current++,
            is_final: true,
            language_code: langCode,
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error saving caption:", insertError);
        } else if (inserted) {
          setCaptions((prev) => [...prev, inserted as Caption]);
        }
      } catch (err) {
        console.error("Error saving caption:", err);
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(`Transcription error: ${msg}`);
    },
  });

  const copyViewerLink = () => {
    navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchToken = async () => {
    const res = await fetch(`/api/scribe-token?eventUid=${event.uid}`);
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? "Failed to fetch token");
    }
    const d = await res.json() as { token: string };
    return d.token;
  };

  const handleStartRecording = async () => {
    try {
      setError(null);
      eventStartRef.current = Date.now();

      // Connect worker WS
      const worker = new WorkerClient({
        onReady: () => setWorkerConnected(true),
        onTranscript: () => { /* Phase 2: translated transcripts from worker */ },
        onListenerStats: (counts) => setListenerCounts(counts),
        onError: (code, message) => console.error(`[worker] ${code}: ${message}`),
        onDisconnected: () => setWorkerConnected(false),
      });
      worker.connect(event.id, selectedSourceLang ?? "auto", targetLangs);
      workerClientRef.current = worker;

      const token = await fetchToken();
      const micOptions: MediaTrackConstraints & { deviceId?: string } = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(selectedDeviceId ? { deviceId: selectedDeviceId } : {}),
      };
      await scribe.connect({
        token,
        microphone: micOptions,
        ...(selectedSourceLang ? { language: selectedSourceLang } : {}),
      } as Parameters<typeof scribe.connect>[0]);

      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start recording");
    }
  };

  const handleStopRecording = async () => {
    try {
      await scribe.disconnect();
      workerClientRef.current?.end();
      workerClientRef.current = null;
      setIsRecording(false);
      setPartialText("");
      setWorkerConnected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop recording");
    }
  };

  // Cleanup worker on unmount
  useEffect(() => {
    return () => { workerClientRef.current?.destroy(); };
  }, []);

  // Load existing captions
  useEffect(() => {
    supabase
      .from("captions")
      .select("*")
      .eq("event_id", event.id)
      .eq("is_final", true)
      .order("sequence_number", { ascending: true })
      .then(({ data, error: err }: { data: Caption[] | null; error: unknown }) => {
        if (err) { console.error("Error loading captions:", err); return; }
        if (data) {
          setCaptions(data);
          sequenceNumberRef.current = data.length;
        }
      });
  }, [event.id, supabase]);

  // Supabase Realtime: final captions + broadcast channel
  useEffect(() => {
    const channel = supabase
      .channel(`captions:${event.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "captions", filter: `event_id=eq.${event.id}` },
        (payload: { new: Caption }) => {
          setCaptions((prev) => prev.some((c) => c.id === payload.new.id) ? prev : [...prev, payload.new]);
        })
      .subscribe();

    const broadcastChannel = supabase
      .channel(`broadcast:${event.uid}`)
      .subscribe();
    broadcastChannelRef.current = broadcastChannel;

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(broadcastChannel);
      broadcastChannelRef.current = null;
    };
  }, [event.id, event.uid, supabase]);

  const totalListeners = Object.values(listenerCounts).reduce((s, n) => s + n, 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Event Info */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <CardTitle className="text-2xl">{event.title}</CardTitle>
                <Badge variant="secondary" className="gap-1">
                  <Radio className="h-3 w-3" />
                  Broadcaster
                </Badge>
                {workerConnected && (
                  <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                    Worker live
                  </Badge>
                )}
                {totalListeners > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3 w-3" />
                    {totalListeners} listening
                  </Badge>
                )}
              </div>
              {event.description && (
                <CardDescription className="text-base">{event.description}</CardDescription>
              )}
              {event.event_code && (
                <p className="text-sm text-muted-foreground mt-1">
                  Join code: <span className="font-mono font-bold text-foreground">{event.event_code}</span>
                </p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm font-medium mb-2">Viewer Link</p>
            <div className="flex gap-2">
              <div className="flex-1 bg-muted px-3 py-2 rounded-md text-sm font-mono truncate">{viewerUrl}</div>
              <Button variant="outline" size="sm" onClick={copyViewerLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/view/${event.uid}`} target="_blank">
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Broadcasting Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Broadcasting Controls</CardTitle>
          <CardDescription>
            {isRecording ? "Recording and transcribing in real-time" : "Configure and start broadcasting"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {!isRecording && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Source Language</label>
                  <LanguageSelector value={selectedSourceLang} onValueChange={setSelectedSourceLang} />
                  <p className="text-xs text-muted-foreground">Leave blank for auto-detect</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Translation Languages</label>
                  <div className="flex flex-wrap gap-2 min-h-[40px] p-2 border rounded-md bg-background">
                    {targetLangs.length === 0 && (
                      <span className="text-sm text-muted-foreground self-center">No target languages — add below</span>
                    )}
                    {targetLangs.map((lang) => (
                      <Badge key={lang} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setTargetLangs((prev) => prev.filter((l) => l !== lang))}>
                        {lang.toUpperCase()} ×
                      </Badge>
                    ))}
                  </div>
                  <LanguageSelector
                    value={null}
                    onValueChange={(lang) => {
                      if (lang && !targetLangs.includes(lang)) setTargetLangs((prev) => [...prev, lang]);
                    }}
                    defaultOption={{ value: null, label: "Add a target language…" }}
                  />
                </div>

                {audioDevices.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Microphone</label>
                    <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a microphone" />
                      </SelectTrigger>
                      <SelectContent>
                        {audioDevices.map((d) => (
                          <SelectItem key={d.deviceId} value={d.deviceId}>
                            {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            <div className="flex items-center justify-center gap-4 p-8 bg-muted/50 border-2 border-dashed rounded-lg">
              {!isRecording ? (
                <Button size="lg" onClick={handleStartRecording} disabled={scribe.isConnected || !selectedDeviceId} className="gap-2">
                  <Mic className="h-5 w-5" />
                  Start Broadcasting
                </Button>
              ) : (
                <Button size="lg" variant="destructive" onClick={handleStopRecording} disabled={!scribe.isConnected} className="gap-2">
                  <MicOff className="h-5 w-5" />
                  Stop Broadcasting
                </Button>
              )}
            </div>

            {isRecording && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse delay-75" />
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse delay-150" />
                  </div>
                  <span className="font-medium">Broadcasting live</span>
                </div>
                {detectedLanguage && (
                  <div className="flex items-center gap-2 justify-center">
                    <Badge variant="secondary" className="gap-1.5">
                      <Languages className="h-3 w-3" />
                      Detected: {detectedLanguage.toUpperCase()}
                    </Badge>
                  </div>
                )}
                {Object.keys(listenerCounts).length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-center">
                    {Object.entries(listenerCounts).map(([lang, count]) => (
                      <Badge key={lang} variant="outline" className="gap-1">
                        {lang.toUpperCase()}: {count}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Caption Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Live Transcript</CardTitle>
          <CardDescription>Source language transcript as it comes in</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/30 rounded-lg p-6 min-h-[300px] max-h-[500px] overflow-y-auto space-y-3">
            {captions.length === 0 && !partialText && (
              <p className="text-muted-foreground text-center py-12">Transcript will appear here as you broadcast</p>
            )}
            {captions.map((caption) => (
              <div key={caption.id} className="bg-background/50 p-3 rounded border">
                <div className="text-xs text-muted-foreground mb-1">
                  {new Date(caption.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </div>
                <div className="text-lg leading-relaxed">{caption.text}</div>
              </div>
            ))}
            {partialText && (
              <div className="bg-primary/5 p-3 rounded border border-primary/20">
                <div className="text-xs text-primary/50 mb-1">Live</div>
                <div className="text-lg leading-relaxed italic">{partialText}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
