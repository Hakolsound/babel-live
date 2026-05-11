"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { LanguageSelector } from "@/components/language-selector"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { LANGUAGES } from "@/lib/languages"
import { Eye, Radio } from "lucide-react"

interface Event {
  id: string
  uid: string
  title: string
  description: string | null
  event_code: string | null
  source_language: string
  target_languages: string[]
  tts_enabled: boolean
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
  const browserLang = typeof navigator !== "undefined"
    ? navigator.language.split("-")[0] ?? null
    : null

  const defaultLang = (() => {
    if (initialLang && event.target_languages.includes(initialLang)) return initialLang
    if (browserLang && event.target_languages.includes(browserLang)) return browserLang
    return event.target_languages[0] ?? null
  })()

  const [selectedLang, setSelectedLang] = useState<string | null>(defaultLang)
  const [entries, setEntries] = useState<TranslatedEntry[]>([])
  const [isLive, setIsLive] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const supabase = getSupabaseBrowserClient()

  // Load existing entries when language changes
  useEffect(() => {
    if (!selectedLang) return
    setEntries([])

    supabase
      .from("transcript_entries")
      .select("*")
      .eq("event_id", event.id)
      .eq("language_code", selectedLang)
      .order("timestamp_ms", { ascending: true })
      .then(({ data }: { data: TranslatedEntry[] | null }) => {
        if (data) setEntries(data)
      })
  }, [selectedLang, event.id, supabase])

  // Realtime subscription for new entries
  useEffect(() => {
    if (!selectedLang) return

    const channel = supabase
      .channel(`transcript:${event.id}:${selectedLang}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transcript_entries",
          filter: `event_id=eq.${event.id}`,
        },
        (payload: { new: TranslatedEntry }) => {
          if (payload.new.language_code !== selectedLang) return
          setIsLive(true)
          setEntries((prev) => {
            if (prev.some((e) => e.id === payload.new.id)) return prev
            return [...prev, payload.new]
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [selectedLang, event.id, supabase])

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  const langName = selectedLang
    ? (LANGUAGES.find((l) => l.code === selectedLang)?.name ?? selectedLang.toUpperCase())
    : "—"

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Event Info */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <CardTitle className="text-2xl">{event.title}</CardTitle>
                <Badge variant="outline" className="gap-1">
                  <Eye className="h-3 w-3" />
                  Viewer
                </Badge>
                {isLive && (
                  <Badge variant="secondary" className="gap-1 text-red-600 border-red-200 bg-red-50">
                    <Radio className="h-3 w-3" />
                    Live
                  </Badge>
                )}
              </div>
              {event.description && (
                <CardDescription className="text-base">{event.description}</CardDescription>
              )}
            </div>
          </div>

          {/* Language picker */}
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium">Your language</p>
            {event.target_languages.length > 0 ? (
              <div className="w-[260px]">
                <LanguageSelector
                  value={selectedLang}
                  onValueChange={setSelectedLang}
                  defaultOption={{ value: null, label: "Pick a language…" }}
                />
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  No translation languages have been configured for this event yet.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Captions */}
      <Card>
        <CardHeader>
          <CardTitle>Live Captions</CardTitle>
          <CardDescription>
            {selectedLang
              ? `Translated to ${langName}`
              : "Select a language above to see captions"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedLang ? (
            <div className="bg-muted/30 rounded-lg p-8 min-h-[400px] flex items-center justify-center">
              <p className="text-muted-foreground">Select a language to start</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="bg-muted/30 rounded-lg p-8 min-h-[400px] flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Eye className="h-5 w-5 text-primary" />
                </div>
                <p className="text-muted-foreground">Waiting for the broadcaster to start…</p>
              </div>
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="bg-muted/30 rounded-lg p-6 min-h-[400px] max-h-[600px] overflow-y-auto space-y-3"
            >
              {entries.map((entry) => (
                <div key={entry.id} className="bg-background/60 p-3 rounded border">
                  <div className="text-xs text-muted-foreground mb-1">
                    {new Date(entry.created_at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                    <span className="ml-2">
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {langName}
                      </Badge>
                    </span>
                  </div>
                  <p className="text-lg leading-relaxed">{entry.text}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
