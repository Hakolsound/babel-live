"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ExternalLink, Radio, Copy, Check, Pencil, Trash2, QrCode, Download } from "lucide-react"
import Link from "next/link"
import { useState, useRef, useCallback } from "react"
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

interface Event {
  id: string
  uid: string
  title: string
  description: string | null
  created_at: string
}

interface EventsListProps {
  events: Event[]
}

export function EventsList({ events: initialEvents }: EventsListProps) {
  const [events, setEvents] = useState<Event[]>(initialEvents)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Edit state
  const [editEvent, setEditEvent] = useState<Event | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Delete state
  const [deleteEvent, setDeleteEvent] = useState<Event | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // QR state
  const [qrEvent, setQrEvent] = useState<Event | null>(null)

  const router = useRouter()
  const supabase = getSupabaseBrowserClient()

  const copyViewerLink = (uid: string) => {
    const link = `${window.location.origin}/view/${uid}`
    navigator.clipboard.writeText(link)
    setCopiedId(uid)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const openEdit = (event: Event) => {
    setEditEvent(event)
    setEditTitle(event.title)
    setEditDescription(event.description ?? "")
    setEditError(null)
  }

  const saveEdit = async () => {
    if (!editEvent || !editTitle.trim()) return
    setEditLoading(true)
    setEditError(null)
    const { error } = await supabase
      .from("events")
      .update({ title: editTitle.trim(), description: editDescription.trim() || null })
      .eq("id", editEvent.id)
    setEditLoading(false)
    if (error) {
      setEditError(error.message)
      return
    }
    setEvents((prev) =>
      prev.map((e) =>
        e.id === editEvent.id
          ? { ...e, title: editTitle.trim(), description: editDescription.trim() || null }
          : e
      )
    )
    setEditEvent(null)
  }

  const confirmDelete = async () => {
    if (!deleteEvent) return
    setDeleteLoading(true)
    const { error } = await supabase.from("events").delete().eq("id", deleteEvent.id)
    setDeleteLoading(false)
    if (!error) {
      setEvents((prev) => prev.filter((e) => e.id !== deleteEvent.id))
    }
    setDeleteEvent(null)
  }

  const downloadQR = useCallback(() => {
    if (!qrEvent) return
    const canvas = document.getElementById("qr-canvas") as HTMLCanvasElement | null
    if (!canvas) return
    const url = canvas.toDataURL("image/png")
    const a = document.createElement("a")
    a.href = url
    a.download = `${qrEvent.title.replace(/\s+/g, "-")}-qr.png`
    a.click()
  }, [qrEvent])

  return (
    <>
      <div className="grid gap-4">
        {events.map((event) => (
          <Card key={event.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-xl">{event.title}</CardTitle>
                  {event.description && <CardDescription className="mt-1.5">{event.description}</CardDescription>}
                  <p className="text-xs text-muted-foreground mt-2">
                    Created {new Date(event.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(event)} title="Edit event">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteEvent(event)}
                    title="Delete event"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button asChild className="flex-1">
                  <Link href={`/broadcast/${event.uid}`}>
                    <Radio className="h-4 w-4 mr-2" />
                    Broadcast
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => copyViewerLink(event.uid)} className="flex-1">
                  {copiedId === event.uid ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Viewer Link
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setQrEvent(event)} title="Show QR code">
                  <QrCode className="h-4 w-4 mr-2" />
                  QR
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/view/${event.uid}`} target="_blank">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editEvent} onOpenChange={(open) => !open && setEditEvent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Event</DialogTitle>
            <DialogDescription>Update the event name and description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Event title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEvent(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editLoading || !editTitle.trim()}>
              {editLoading ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteEvent} onOpenChange={(open) => !open && setDeleteEvent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteEvent?.title}</strong> will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* QR Code Dialog */}
      <Dialog open={!!qrEvent} onOpenChange={(open) => !open && setQrEvent(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Viewer QR Code</DialogTitle>
            <DialogDescription>{qrEvent?.title}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {qrEvent && (
              <>
                <div className="rounded-xl border p-4 bg-white">
                  <QRCodeCanvas
                    id="qr-canvas"
                    value={`${typeof window !== "undefined" ? window.location.origin : ""}/view/${qrEvent.uid}`}
                    size={220}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center break-all">
                  {typeof window !== "undefined" ? window.location.origin : ""}/view/{qrEvent.uid}
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQrEvent(null)}>Close</Button>
            <Button onClick={downloadQR}>
              <Download className="h-4 w-4 mr-2" />
              Download PNG
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
