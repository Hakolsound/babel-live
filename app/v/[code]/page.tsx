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
    .select("id, uid, title, description, event_code, source_language, target_languages, tts_enabled")
    .eq("event_code", code.toUpperCase())
    .single()

  if (error || !event) notFound()

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xl">TODO_BRAND</span>
            <span className="text-sm text-muted-foreground font-mono">{event.event_code}</span>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <TranslatedViewer event={event} initialLang={lang ?? null} />
      </main>
    </div>
  )
}
