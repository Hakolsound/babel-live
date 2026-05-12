"use client"

import { useRef, useCallback, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { Download, QrCode, X } from "lucide-react"
import { Button } from "@/components/ui/button" // used for download button only

interface EventQRProps {
  url: string
  eventCode: string
  eventTitle: string
}

export function EventQR({ url, eventCode, eventTitle }: EventQRProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleDownload = useCallback(() => {
    const svg = containerRef.current?.querySelector("svg")
    if (!svg) return

    const size = 512
    const padding = 48
    const inner = size - padding * 2

    const clone = svg.cloneNode(true) as SVGElement
    clone.setAttribute("width", String(size))
    clone.setAttribute("height", String(size))
    clone.setAttribute("viewBox", `${-padding} ${-padding} ${size} ${size}`)

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect")
    bg.setAttribute("x", String(-padding))
    bg.setAttribute("y", String(-padding))
    bg.setAttribute("width", String(size))
    bg.setAttribute("height", String(size))
    bg.setAttribute("fill", "white")
    clone.insertBefore(bg, clone.firstChild)

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text")
    label.setAttribute("x", String(inner / 2))
    label.setAttribute("y", String(inner + 28))
    label.setAttribute("text-anchor", "middle")
    label.setAttribute("font-family", "monospace")
    label.setAttribute("font-size", "22")
    label.setAttribute("font-weight", "bold")
    label.setAttribute("fill", "#000")
    label.textContent = eventCode
    clone.appendChild(label)

    const svgStr = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([svgStr], { type: "image/svg+xml" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `babel-${eventCode.toLowerCase()}-qr.svg`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [eventCode])

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Show QR code"
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] transition-colors"
        style={{ border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)", background: "transparent" }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.85)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        <QrCode className="h-3.5 w-3.5" />
        QR
      </button>

      {/* Popover */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="absolute left-0 top-full mt-2 z-50 bg-white border border-black/10 rounded-2xl shadow-xl p-6 w-64 flex flex-col items-center gap-4">
            {/* Close */}
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 text-black/30 hover:text-black transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            {/* QR */}
            <div ref={containerRef} className="p-3 bg-white border border-black/10 rounded-xl">
              <QRCodeSVG
                value={url}
                size={168}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>

            {/* Code + URL */}
            <div className="text-center space-y-0.5 w-full">
              <p className="font-mono font-black text-2xl tracking-widest">{eventCode}</p>
              <p className="text-[11px] text-black/35 break-all leading-snug">{url}</p>
            </div>

            {/* Download */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="w-full gap-2 border-black/15 hover:border-black text-sm"
              style={{ color: "black" }}
            >
              <Download className="h-3.5 w-3.5" />
              Download SVG
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
