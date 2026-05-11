import { redirect } from "next/navigation"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { CreateEventForm } from "@/components/create-event-form"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Captions } from "lucide-react"
import Link from "next/link"

export default async function CreateEventPage() {
  const supabase = await getSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/signin")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Captions className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">TODO_BRAND</span>
          </div>
          <Button variant="ghost" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">Create New Event</h1>
            <p className="text-muted-foreground mt-1">Set up a new live caption event for your audience</p>
          </div>
          <CreateEventForm userId={user.id} />
        </div>
      </main>
    </div>
  )
}
