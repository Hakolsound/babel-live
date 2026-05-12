import { redirect, notFound } from "next/navigation"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { BroadcasterInterface } from "@/components/broadcaster-interface"

interface BroadcastPageProps {
  params: Promise<{ uid: string }>
}

export default async function BroadcastPage({ params }: BroadcastPageProps) {
  const { uid } = await params
  const supabase = await getSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/signin")

  const { data: event, error } = await supabase.from("events").select("*").eq("uid", uid).single()
  if (error || !event) notFound()
  if (event.creator_id !== user.id) redirect("/dashboard")

  const viewerUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/v/${event.event_code}`

  return <BroadcasterInterface event={event} viewerUrl={viewerUrl} />
}
