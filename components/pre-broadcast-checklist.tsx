"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Checks {
  micSelected: boolean;
  targetLangs: boolean;
  workerUrl: boolean;
}

interface PreBroadcastChecklistProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  checks: Checks;
}

const CHECK_LABELS: Record<keyof Checks, string> = {
  micSelected: "Microphone selected",
  targetLangs: "At least one target language",
  workerUrl: "Worker URL configured",
};

export function PreBroadcastChecklist({ open, onClose, onConfirm, checks }: PreBroadcastChecklistProps) {
  if (!open) return null;

  const allPass = Object.values(checks).every(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Pre-broadcast checklist"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-5">
        <div>
          <h2 className="text-white font-black text-lg">Pre-broadcast Checklist</h2>
          <p className="text-white/40 text-xs mt-1">Confirm everything is ready before going live.</p>
        </div>

        <ul className="space-y-3">
          {(Object.keys(checks) as Array<keyof Checks>).map((key) => {
            const pass = checks[key];
            return (
              <li key={key} className="flex items-center gap-3">
                {pass ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                )}
                <span className={`text-sm ${pass ? "text-white/80" : "text-red-300/80"}`}>
                  {CHECK_LABELS[key]}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="flex gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="flex-1 text-white/50 hover:text-white hover:bg-white/10 border border-white/10"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={!allPass}
            className="flex-1 bg-white text-black hover:bg-white/90 font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start Broadcasting
          </Button>
        </div>
      </div>
    </div>
  );
}
