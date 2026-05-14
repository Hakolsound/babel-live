import { notFound } from "next/navigation"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { TranslatedViewer } from "@/components/translated-viewer"

interface ViewerPageProps {
  params: Promise<{ code: string }>
  searchParams: Promise<{ lang?: string }>
}

export default async function ViewerPage({ params, searchParams }: ViewerPageProps) {
  const { code } = await params
  const { lang } = await searchParams
  const supabase = await getSupabaseServerClient()

  const { data: event, error } = await supabase
    .from("events")
    .select("id, uid, title, description, event_code, source_language, target_languages, tts_enabled, fly_region")
    .eq("event_code", code.toUpperCase())
    .single()

  if (error || !event) notFound()

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-black/10">
        <span className="font-black text-lg tracking-tight">BABEL</span>
        <span className="font-mono text-sm font-bold tracking-widest text-black/40">
          {event.event_code}
        </span>
      </header>

      {/* Full-height viewer */}
      <main className="flex-1 flex flex-col">
        <TranslatedViewer event={event} initialLang={lang ?? null} />
      </main>
    </div>
  )
}
