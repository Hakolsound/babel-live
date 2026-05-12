"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  BookOpen,
  Sparkles,
  Save,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  Tag,
  Search,
  Globe,
  Youtube,
  Brain,
  Table2,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { EventKnowledge } from "@/lib/worker-types";
import type { SuggestedTerm } from "@/app/api/suggest-keyterms/route";
import type { ResearchEvent, ResearchResult, ResearchKeyterm } from "@/app/api/research-event/route";
import type { SuggestedTranslations } from "@/app/api/suggest-translations/route";

// Language display names for table headers
const LANG_NAMES: Record<string, string> = {
  he: "Hebrew", en: "English", es: "Spanish", fr: "French", de: "German",
  pt: "Portuguese", ar: "Arabic", ru: "Russian", zh: "Chinese", ja: "Japanese",
  ko: "Korean", it: "Italian", nl: "Dutch", tr: "Turkish", pl: "Polish",
  hi: "Hindi", uk: "Ukrainian", vi: "Vietnamese", id: "Indonesian", th: "Thai",
};

const DOMAINS = [
  "Technology",
  "Medical / Healthcare",
  "Legal",
  "Finance",
  "Science",
  "Engineering",
  "Education",
  "Business & Management",
  "Media & Entertainment",
  "Government & Policy",
  "Sports",
  "Arts & Culture",
] as const;

const TIER_ORDER: SuggestedTerm["tier"][] = ["core", "common", "advanced", "rare"];
const TIER_LABELS: Record<SuggestedTerm["tier"], string> = {
  core: "Core — always keep",
  common: "Common",
  advanced: "Advanced",
  rare: "Rare / niche",
};
const TIER_DEFAULT_CHECKED: Record<SuggestedTerm["tier"], boolean> = {
  core: true,
  common: true,
  advanced: false,
  rare: false,
};

const RESEARCH_STEPS: Record<string, { label: string; icon: React.ReactNode }> = {
  searching:    { label: "Searching the web…",       icon: <Search className="h-3 w-3" /> },
  found:        { label: "Results found",             icon: <Globe className="h-3 w-3" /> },
  fetching:     { label: "Reading pages…",            icon: <Globe className="h-3 w-3" /> },
  fetched:      { label: "Pages read",                icon: <Youtube className="h-3 w-3" /> },
  synthesizing: { label: "Extracting knowledge…",    icon: <Brain className="h-3 w-3" /> },
};

interface KnowledgePanelProps {
  /** Required for save-to-DB. Omit in creation wizard (save handled externally). */
  eventId?: string;
  eventTitle?: string;
  organization?: string;
  targetLangs?: string[];
  /** Auto-fire research on mount (wizard mode) */
  autoResearch?: boolean;
  /** Hide card chrome (no collapsible header) and save button */
  creationMode?: boolean;
  /** Start with the card body expanded (non-creation mode only) */
  defaultOpen?: boolean;
  initial: {
    domain: string;
    subdomain: string;
    specialty: string;
    briefing: string;
    keyterms: string[];
    termTranslations?: Record<string, Record<string, string>>;
  };
  onChange: (knowledge: EventKnowledge) => void;
}

export function KnowledgePanel({
  eventId,
  eventTitle = "",
  organization: initialOrg = "",
  targetLangs = [],
  autoResearch = false,
  creationMode = false,
  defaultOpen = false,
  initial,
  onChange,
}: KnowledgePanelProps) {
  const [open, setOpen] = useState(creationMode ? true : defaultOpen);

  const [organization, setOrganization] = useState(initialOrg);
  const [domain, setDomain] = useState(initial.domain);
  const [subdomain, setSubdomain] = useState(initial.subdomain);
  const [specialty, setSpecialty] = useState(initial.specialty);
  const [briefing, setBriefing] = useState(initial.briefing);
  const [keyterms, setKeyterms] = useState<string[]>(initial.keyterms);
  const [customInput, setCustomInput] = useState("");
  const [termTranslations, setTermTranslations] = useState<Record<string, Record<string, string>>>(
    initial.termTranslations ?? {}
  );
  const [tableOpen, setTableOpen] = useState(true);
  const [translatingTerms, setTranslatingTerms] = useState<Set<string>>(new Set());
  const [translateError, setTranslateError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<SuggestedTerm[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // Research state
  const [researching, setResearching] = useState(false);
  const [researchStep, setResearchStep] = useState<string | null>(null);
  const [researchMessage, setResearchMessage] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(false);

  const supabase = getSupabaseBrowserClient();

  // Auto-fire research on mount in wizard mode
  useEffect(() => {
    if (autoResearch && (eventTitle || initialOrg)) {
      handleResearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save to DB when knowledge changes (skip creation mode and first mount)
  useEffect(() => {
    if (!eventId || creationMode) return;
    if (!isMounted.current) { isMounted.current = true; return; }
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("events")
        .update({
          organization: organization || null,
          knowledge_domain: domain,
          knowledge_subdomain: subdomain,
          knowledge_specialty: specialty,
          knowledge_briefing: briefing,
          knowledge_keyterms: keyterms,
          knowledge_term_translations: Object.keys(termTranslations).length > 0 ? termTranslations : null,
        })
        .eq("id", eventId);
      if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    }, 1200);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, subdomain, specialty, briefing, keyterms, termTranslations]);

  // Auto-generate translations on load if we have terms+langs but no translations yet
  useEffect(() => {
    if (
      initial.keyterms.length > 0 &&
      targetLangs.length > 0 &&
      Object.keys(initial.termTranslations ?? {}).length === 0
    ) {
      autoTranslateTerms(initial.keyterms, initial.keyterms);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentKnowledge = useCallback((): EventKnowledge => ({
    domain, subdomain, specialty, briefing, keyterms, termTranslations,
  }), [domain, subdomain, specialty, briefing, keyterms, termTranslations]);

  // ── Translation table helpers ───────────────────────────────────────────────

  const updateTranslation = (term: string, lang: string, value: string) => {
    setTermTranslations((prev) => {
      const next = { ...prev, [term]: { ...(prev[term] ?? {}), [lang]: value } };
      onChange({ domain, subdomain, specialty, briefing, keyterms, termTranslations: next });
      return next;
    });
  };

  const autoTranslateTerms = async (newTerms: string[], currentKeyterms: string[]) => {
    if (newTerms.length === 0 || targetLangs.length === 0) return;
    setTranslatingTerms((prev) => new Set([...prev, ...newTerms]));
    setTranslateError(null);
    try {
      const res = await fetch("/api/suggest-translations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: newTerms, targetLangs, domain, subdomain, specialty }),
      });
      if (!res.ok) throw new Error("Failed to generate translations");
      const data = await res.json() as SuggestedTranslations;
      setTermTranslations((prev) => {
        const next = { ...prev };
        for (const [term, langs] of Object.entries(data.translations)) {
          next[term] = { ...(next[term] ?? {}), ...langs };
        }
        onChange({ domain, subdomain, specialty, briefing, keyterms: currentKeyterms, termTranslations: next });
        return next;
      });
    } catch {
      setTranslateError("Could not auto-suggest translations. Edit cells manually.");
    } finally {
      setTranslatingTerms((prev) => {
        const next = new Set(prev);
        newTerms.forEach((t) => next.delete(t));
        return next;
      });
    }
  };

  // ── Research pipeline ───────────────────────────────────────────────────────

  const handleResearch = async () => {
    setResearching(true);
    setResearchStep("searching");
    setResearchMessage(null);
    setResearchError(null);
    setResearchResult(null);

    try {
      let eventName = eventTitle;
      if (!eventName && eventId) {
        const { data: eventRow } = await supabase
          .from("events")
          .select("title")
          .eq("id", eventId)
          .single();
        eventName = eventRow?.title ?? domain;
      }
      if (!eventName) eventName = domain;

      const res = await fetch("/api/research-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventName, organization }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Research request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6);
          if (!json.trim()) continue;
          const event = JSON.parse(json) as ResearchEvent;

          if (event.type === "progress") {
            setResearchStep(event.step);
            setResearchMessage(event.message);
          } else if (event.type === "complete") {
            setResearchResult(event.result);
            applyResearchResult(event.result);
          } else if (event.type === "error") {
            setResearchError(event.message);
          }
        }
      }
    } catch (err) {
      setResearchError(err instanceof Error ? err.message : "Research failed");
    } finally {
      setResearching(false);
      readerRef.current = null;
    }
  };

  const applyResearchResult = (result: ResearchResult) => {
    const matchedDomain = (DOMAINS as readonly string[]).includes(result.domain)
      ? result.domain
      : domain;

    setDomain(matchedDomain);
    setSubdomain(result.subdomain);
    setSpecialty(result.specialty);
    setBriefing(result.briefing);

    const terms: SuggestedTerm[] = result.keyterms.map((kt: ResearchKeyterm) => ({
      term: kt.term,
      tier: kt.tier,
      reason: `[${kt.source}] ${kt.reason}`,
    }));
    setSuggestions(terms);
    const initialChecked: Record<string, boolean> = {};
    for (const t of terms) {
      initialChecked[t.term] = TIER_DEFAULT_CHECKED[t.tier];
    }
    setChecked(initialChecked);

    onChange({
      domain: matchedDomain,
      subdomain: result.subdomain,
      specialty: result.specialty,
      briefing: result.briefing,
      keyterms,
      termTranslations,
    });
  };

  // ── Suggest terms ───────────────────────────────────────────────────────────

  const handleSuggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    setSuggestions([]);

    try {
      const res = await fetch("/api/suggest-keyterms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, subdomain, specialty, briefing, existing: keyterms }),
      });
      if (!res.ok) throw new Error("Failed to get suggestions");
      const data = await res.json() as { terms: SuggestedTerm[] };
      setSuggestions(data.terms);
      const initial: Record<string, boolean> = {};
      for (const t of data.terms) {
        initial[t.term] = TIER_DEFAULT_CHECKED[t.tier];
      }
      setChecked(initial);
    } catch {
      setSuggestError("Could not generate suggestions. Try again.");
    } finally {
      setSuggesting(false);
    }
  };

  const acceptSuggestions = () => {
    const accepted = suggestions.filter((s) => checked[s.term]).map((s) => s.term);
    const merged = Array.from(new Set([...keyterms, ...accepted]));
    const newTerms = accepted.filter((t) => !keyterms.includes(t));
    setKeyterms(merged);
    setSuggestions([]);
    setChecked({});
    onChange({ domain, subdomain, specialty, briefing, keyterms: merged, termTranslations });
    if (newTerms.length > 0) autoTranslateTerms(newTerms, merged);
  };

  const addCustomTerm = () => {
    const term = customInput.trim();
    if (!term || keyterms.includes(term)) { setCustomInput(""); return; }
    const next = [...keyterms, term];
    setKeyterms(next);
    setCustomInput("");
    onChange({ domain, subdomain, specialty, briefing, keyterms: next, termTranslations });
    autoTranslateTerms([term], next);
  };

  const removeTerm = (term: string) => {
    const next = keyterms.filter((t) => t !== term);
    setKeyterms(next);
    const nextTranslations = { ...termTranslations };
    delete nextTranslations[term];
    setTermTranslations(nextTranslations);
    onChange({ domain, subdomain, specialty, briefing, keyterms: next, termTranslations: nextTranslations });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const { error } = await supabase
      .from("events")
      .update({
        organization: organization || null,
        knowledge_domain: domain,
        knowledge_subdomain: subdomain,
        knowledge_specialty: specialty,
        knowledge_briefing: briefing,
        knowledge_keyterms: keyterms,
        knowledge_term_translations: Object.keys(termTranslations).length > 0 ? termTranslations : null,
      })
      .eq("id", eventId);
    setSaving(false);
    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChange(currentKnowledge());
    }
  };

  const termsByTier = TIER_ORDER.reduce<Record<string, SuggestedTerm[]>>((acc, tier) => {
    acc[tier] = suggestions.filter((s) => s.tier === tier);
    return acc;
  }, {});

  const hasResearchInput = !!(domain || subdomain || specialty || briefing || organization);
  const hasTranslationTable = targetLangs.length > 0;

  const body = (
    <>
          {/* Organization + Research */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                className="h-9 text-sm flex-1"
                placeholder="Organization (optional, improves research)"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 text-xs whitespace-nowrap"
                onClick={handleResearch}
                disabled={researching}
              >
                {researching
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Search className="h-3 w-3" />}
                {researching ? "Researching…" : "Research event"}
              </Button>
            </div>

            {(researching || researchMessage) && !researchError && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                {researching && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
                {researchStep && RESEARCH_STEPS[researchStep] && (
                  <span className="text-primary">{RESEARCH_STEPS[researchStep]!.icon}</span>
                )}
                <span>{researchMessage ?? "Starting…"}</span>
              </div>
            )}

            {researchResult && !researching && (
              <div className="flex items-center gap-2 text-xs text-green-600 px-1">
                <Check className="h-3 w-3" />
                <span>
                  Research complete — {researchResult.sources.length} source{researchResult.sources.length !== 1 ? "s" : ""}.
                  Review suggested terms below.
                </span>
              </div>
            )}

            {researchError && (
              <p className="text-xs text-destructive px-1">{researchError}</p>
            )}
          </div>

          <Separator />

          {/* Domain hierarchy */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Domain</label>
              <Select value={domain} onValueChange={(v) => { setDomain(v); onChange({ domain: v, subdomain, specialty, briefing, keyterms, termTranslations }); }}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Pick domain…" />
                </SelectTrigger>
                <SelectContent>
                  {DOMAINS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subdomain</label>
              <Input
                className="h-9 text-sm"
                placeholder="e.g. Dermatology"
                value={subdomain}
                onChange={(e) => { setSubdomain(e.target.value); onChange({ domain, subdomain: e.target.value, specialty, briefing, keyterms, termTranslations }); }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Specialty</label>
              <Input
                className="h-9 text-sm"
                placeholder="e.g. Mohs Surgery"
                value={specialty}
                onChange={(e) => { setSpecialty(e.target.value); onChange({ domain, subdomain, specialty: e.target.value, briefing, keyterms, termTranslations }); }}
              />
            </div>
          </div>

          {/* Briefing */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Event Briefing</label>
            <Textarea
              className="text-sm resize-none"
              rows={3}
              placeholder="Describe this event: topic, speaker background, expected terminology…"
              value={briefing}
              onChange={(e) => { setBriefing(e.target.value); onChange({ domain, subdomain, specialty, briefing: e.target.value, keyterms, termTranslations }); }}
            />
          </div>

          <Separator />

          {/* Key terms */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Tag className="h-3 w-3" />
                Key Terms
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={handleSuggest}
                disabled={suggesting || !hasResearchInput}
              >
                {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {suggesting ? "Generating…" : "Suggest terms"}
              </Button>
            </div>

            {keyterms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 border rounded-md bg-muted/30 min-h-[36px]">
                {keyterms.map((term) => (
                  <Badge key={term} variant="secondary" className="gap-1 pr-1 text-xs font-mono">
                    {term}
                    <button
                      type="button"
                      onClick={() => removeTerm(term)}
                      className="ml-0.5 rounded-sm hover:bg-destructive/20 p-0.5"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                className="h-8 text-sm font-mono"
                placeholder="Add custom term…"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTerm(); } }}
              />
              <Button type="button" size="sm" variant="outline" className="h-8 px-3" onClick={addCustomTerm}>
                Add
              </Button>
            </div>

            {suggestError && (
              <p className="text-xs text-destructive">{suggestError}</p>
            )}
          </div>

          {/* Suggestions panel */}
          {suggestions.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-primary" />
                  {suggestions.length} suggested terms — check to accept
                </span>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setSuggestions([])}>
                    Dismiss
                  </Button>
                  <Button type="button" size="sm" className="h-6 text-xs gap-1" onClick={acceptSuggestions}>
                    Accept checked
                    {targetLangs.length > 0 && (
                      <span className="opacity-60">+ translate</span>
                    )}
                  </Button>
                </div>
              </div>
              <div className="divide-y max-h-72 overflow-y-auto">
                {TIER_ORDER.map((tier) => {
                  const items = termsByTier[tier] ?? [];
                  if (items.length === 0) return null;
                  return (
                    <div key={tier}>
                      <div className="px-3 py-1.5 bg-muted/20 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground font-medium">{TIER_LABELS[tier]}</span>
                        <div className="flex gap-2">
                          <button type="button" className="text-xs text-primary hover:underline" onClick={() => {
                            const u = { ...checked };
                            items.forEach((i) => { u[i.term] = true; });
                            setChecked(u);
                          }}>all</button>
                          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => {
                            const u = { ...checked };
                            items.forEach((i) => { u[i.term] = false; });
                            setChecked(u);
                          }}>none</button>
                        </div>
                      </div>
                      {items.map((s) => (
                        <div key={s.term} className="flex items-start gap-3 px-3 py-2 hover:bg-muted/20">
                          <Checkbox
                            id={`term-${s.term}`}
                            checked={!!checked[s.term]}
                            onCheckedChange={(v) => setChecked((p) => ({ ...p, [s.term]: !!v }))}
                            className="mt-0.5"
                          />
                          <label htmlFor={`term-${s.term}`} className="flex-1 cursor-pointer">
                            <span className="text-sm font-mono font-medium">{s.term}</span>
                            <span className="text-xs text-muted-foreground ml-2">{s.reason}</span>
                          </label>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Translation Table ─────────────────────────────────────────────── */}
          {hasTranslationTable && (
            <>
              <Separator />
              <div className="space-y-2">
                <div
                  className="flex items-center justify-between cursor-pointer select-none"
                  onClick={() => setTableOpen((o) => !o)}
                >
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 cursor-pointer">
                    <Table2 className="h-3 w-3" />
                    Translation Table
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                      {targetLangs.length} {targetLangs.length === 1 ? "language" : "languages"}
                    </Badge>
                    {translatingTerms.size > 0 && (
                      <span className="flex items-center gap-1 text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="text-[10px] normal-case">suggesting…</span>
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    {keyterms.length > 0 && translatingTerms.size === 0 && (
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
                        onClick={(e) => { e.stopPropagation(); autoTranslateTerms(keyterms, keyterms); }}
                      >
                        re-generate
                      </button>
                    )}
                    {tableOpen
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                </div>

                {translateError && (
                  <p className="text-xs text-muted-foreground px-1">{translateError}</p>
                )}

                {tableOpen && keyterms.length === 0 && (
                  <div className="border rounded-lg px-4 py-6 text-center text-xs text-muted-foreground">
                    Accept key terms above — translations will be auto-generated here.
                  </div>
                )}

                {tableOpen && keyterms.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/40 border-b">
                            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-40">
                              Term
                            </th>
                            {targetLangs.map((lang) => (
                              <th key={lang} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground min-w-[120px]">
                                {LANG_NAMES[lang] ?? lang.toUpperCase()}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {keyterms.map((term) => {
                            const isLoading = translatingTerms.has(term);
                            return (
                              <tr key={term} className="hover:bg-muted/10">
                                <td className="px-3 py-1.5">
                                  <span className="font-mono text-xs font-medium">{term}</span>
                                </td>
                                {targetLangs.map((lang) => {
                                  const val = termTranslations[term]?.[lang] ?? "";
                                  return (
                                    <td key={lang} className="px-2 py-1 relative">
                                      {isLoading && !val ? (
                                        <div className="flex items-center gap-1 px-1 text-xs text-muted-foreground/50">
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        </div>
                                      ) : (
                                        <Input
                                          className="h-7 text-xs font-mono border-0 bg-transparent px-1 focus-visible:ring-1 focus-visible:ring-primary/50 placeholder:text-muted-foreground/40"
                                          placeholder="keep as-is"
                                          value={val}
                                          onChange={(e) => updateTranslation(term, lang, e.target.value)}
                                        />
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-3 py-2 bg-muted/20 border-t text-xs text-muted-foreground">
                      Translations are auto-suggested. Empty = let AI translate freely. Edit any cell to override.
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Save — hidden in creation mode (wizard handles save) */}
          {!creationMode && eventId && (
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSave}
                disabled={saving}
                className="gap-2"
              >
                {saved ? <Check className="h-4 w-4 text-green-500" /> : <Save className="h-4 w-4" />}
                {saving ? "Saving…" : saved ? "Saved" : "Save knowledge base"}
              </Button>
            </div>
          )}
        </>
  );

  if (creationMode) {
    return <div className="space-y-5">{body}</div>;
  }

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Knowledge Base</CardTitle>
            {keyterms.length > 0 && (
              <Badge variant="secondary" className="text-xs">{keyterms.length} terms</Badge>
            )}
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
        <CardDescription className="text-xs mt-0.5">
          Domain context and key terms that improve translation accuracy
        </CardDescription>
      </CardHeader>
      {open && <CardContent className="space-y-5 pt-0">{body}</CardContent>}
    </Card>
  );
}
