"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ArrowLeft, X } from "lucide-react";
import { LanguageSelector } from "@/components/language-selector";
import { KnowledgePanel } from "@/components/knowledge-panel";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { nanoid } from "nanoid";
import { generateEventCode } from "@/lib/event-code";
import type { EventKnowledge } from "@/lib/worker-types";

interface CreateEventWizardProps {
  userId: string;
}

interface Step1Data {
  title: string;
  organization: string;
  sourceLang: string | null;
  targetLangs: string[];
}

export function CreateEventWizard({ userId }: CreateEventWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [step1, setStep1] = useState<Step1Data>({
    title: "",
    organization: "",
    sourceLang: null,
    targetLangs: [],
  });
  const [knowledge, setKnowledge] = useState<EventKnowledge>({
    domain: "",
    subdomain: "",
    specialty: "",
    briefing: "",
    keyterms: [],
    termTranslations: {},
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const handleCreate = async () => {
    setCreating(true);
    setError(null);

    const uid = nanoid(10);
    const event_code = generateEventCode();

    const { data, error: insertError } = await supabase
      .from("events")
      .insert({
        uid,
        title: step1.title.trim(),
        organization: step1.organization.trim() || null,
        source_language: step1.sourceLang ?? "auto",
        target_languages: step1.targetLangs,
        creator_id: userId,
        event_code,
        tts_enabled: true,
        knowledge_domain: knowledge.domain || null,
        knowledge_subdomain: knowledge.subdomain || null,
        knowledge_specialty: knowledge.specialty || null,
        knowledge_briefing: knowledge.briefing || null,
        knowledge_keyterms: knowledge.keyterms.length > 0 ? knowledge.keyterms : null,
        knowledge_term_translations:
          knowledge.termTranslations && Object.keys(knowledge.termTranslations).length > 0
            ? knowledge.termTranslations
            : null,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setCreating(false);
    } else {
      router.push(`/broadcast/${uid}`);
    }
  };

  // ── Step 1 ─────────────────────────────────────────────────────────────────

  if (step === 1) {
    const canContinue = step1.title.trim().length > 0;

    return (
      <div className="space-y-8">
        {/* Progress */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">1</div>
            <span className="text-sm font-medium">Event Setup</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full border-2 border-muted-foreground/30 text-muted-foreground/50 text-xs font-semibold flex items-center justify-center">2</div>
            <span className="text-sm text-muted-foreground">Knowledge Base</span>
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">Event Name *</Label>
            <Input
              id="title"
              placeholder="e.g. Annual Dermatology Summit 2025"
              value={step1.title}
              onChange={(e) => setStep1((p) => ({ ...p, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter" && canContinue) setStep(2); }}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="org">Organization <span className="text-muted-foreground font-normal">(optional — improves research)</span></Label>
            <Input
              id="org"
              placeholder="e.g. Israeli Dermatology Society"
              value={step1.organization}
              onChange={(e) => setStep1((p) => ({ ...p, organization: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Source Language</Label>
              <LanguageSelector
                value={step1.sourceLang}
                onValueChange={(v) => setStep1((p) => ({ ...p, sourceLang: v }))}
                defaultOption={{ value: null, label: "Auto-detect" }}
              />
              <p className="text-xs text-muted-foreground">Leave blank for auto-detect</p>
            </div>

            <div className="space-y-2">
              <Label>Translation Languages</Label>
              <LanguageSelector
                value={null}
                onValueChange={(lang) => {
                  if (lang && !step1.targetLangs.includes(lang)) {
                    setStep1((p) => ({ ...p, targetLangs: [...p.targetLangs, lang] }));
                  }
                }}
                defaultOption={{ value: null, label: "Add a language…" }}
              />
              {step1.targetLangs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {step1.targetLangs.map((lang) => (
                    <Badge key={lang} variant="secondary" className="gap-1 pr-1">
                      {lang.toUpperCase()}
                      <button
                        type="button"
                        onClick={() => setStep1((p) => ({ ...p, targetLangs: p.targetLangs.filter((l) => l !== lang) }))}
                        className="ml-0.5 rounded-sm hover:bg-destructive/20 p-0.5"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end">
          <Button onClick={() => setStep(2)} disabled={!canContinue} className="gap-2">
            Next: Knowledge Base
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Step 2 ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="w-7 h-7 rounded-full border-2 border-primary text-primary text-xs font-semibold flex items-center justify-center hover:bg-primary/10 transition-colors"
          >
            1
          </button>
          <button type="button" onClick={() => setStep(1)} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Event Setup
          </button>
        </div>
        <div className="flex-1 h-px bg-primary/30" />
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">2</div>
          <span className="text-sm font-medium">Knowledge Base</span>
        </div>
      </div>

      {/* Event summary pill */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
        <span className="font-medium text-foreground">{step1.title}</span>
        {step1.organization && <><span>·</span><span>{step1.organization}</span></>}
        {step1.targetLangs.length > 0 && (
          <><span>·</span>{step1.targetLangs.map((l) => <Badge key={l} variant="outline" className="text-xs px-1.5 py-0">{l.toUpperCase()}</Badge>)}</>
        )}
      </div>

      {/* Knowledge panel in creation mode — no eventId, auto-research fires on mount */}
      <KnowledgePanel
        eventTitle={step1.title}
        organization={step1.organization}
        targetLangs={step1.targetLangs}
        initial={knowledge}
        onChange={setKnowledge}
        autoResearch
        creationMode
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="ghost" onClick={() => setStep(1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={handleCreate} disabled={creating}>
            {creating ? "Creating…" : "Skip for now"}
          </Button>
          <Button type="button" onClick={handleCreate} disabled={creating} className="gap-2">
            {creating ? "Creating…" : "Create Event"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
