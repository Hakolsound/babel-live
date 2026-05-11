import { redirect, notFound } from "next/navigation"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { BroadcasterInterface } from "@/components/broadcaster-interface"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Captions } from "lucide-react"
import Link from "next/link"

interface BroadcastPageProps {
  params: Promise<{
    uid: string
  }>
}

export default async function BroadcastPage({ params }: BroadcastPageProps) {
  const { uid } = await params
  const supabase = await getSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/signin")
  }

  // Fetch the event
  const { data: event, error } = await supabase.from("events").select("*").eq("uid", uid).single()

  if (error || !event) {
    notFound()
  }

  // Check if the user is the creator
  if (event.creator_id !== user.id) {
    redirect("/dashboard")
  }

  const viewerUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/view/${uid}`

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Captions className="h-6 w-6 text-primary" />
              <span className="font-bold text-xl">TODO_BRAND</span>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
              <span>/</span>
              <span className="font-medium text-foreground">{event.title}</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Dashboard
            </Link>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <BroadcasterInterface event={event} viewerUrl={viewerUrl} />
      </main>
    </div>
  )
}
