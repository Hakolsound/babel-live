import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface SuggestedTerm {
  term: string;
  tier: "core" | "common" | "advanced" | "rare";
  reason: string;
}

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    domain?: string;
    subdomain?: string;
    specialty?: string;
    briefing?: string;
    existing?: string[];
  };

  const { domain = "", subdomain = "", specialty = "", briefing = "", existing = [] } = body;

  if (!domain && !subdomain && !specialty && !briefing) {
    return NextResponse.json({ error: "At least one field required" }, { status: 400 });
  }

  const hierarchyParts = [domain, subdomain, specialty].filter(Boolean);
  const hierarchyStr = hierarchyParts.join(" › ");
  const existingStr = existing.length > 0
    ? `\nAlready accepted by user (exclude from suggestions): ${existing.join(", ")}`
    : "";
  const briefingStr = briefing
    ? `\nEvent briefing: "${briefing}"`
    : "";

  const prompt = `You are a translation quality expert configuring a real-time AI interpretation system.

Field: ${hierarchyStr || "General"}${briefingStr}${existingStr}

Generate 24 terms that a real-time translation AI would likely mistranslate, mispronounce, corrupt, or over-translate when interpreting spoken content in this field. Focus on:
- Proper nouns and eponyms that must stay as-is (names of techniques, people, instruments)
- Acronyms that must not be spelled out or translated
- Brand/product names that have no translation
- Latin, Greek, or foreign-origin technical terms where translation conventions vary
- Newly coined terms or jargon the model may not know
- Numbers/units that look like words in other languages

Assign tiers:
- core: Essential — every talk in this field uses these, always keep them
- common: Frequent — most talks use these, usually keep them
- advanced: Specialized — appears in expert-level content
- rare: Niche — only in highly specific subfields or cutting-edge work

Return ONLY a JSON array, no prose, no markdown fences:
[{"term":"...","tier":"core"|"common"|"advanced"|"rare","reason":"one line why AI would corrupt this"}]`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0];
    if (!raw || raw.type !== "text") {
      throw new Error("Unexpected Claude response");
    }

    // Strip any accidental markdown fences
    const cleaned = raw.text.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const terms = JSON.parse(cleaned) as SuggestedTerm[];

    return NextResponse.json({ terms });
  } catch (err) {
    console.error("[suggest-keyterms]", err);
    return NextResponse.json({ error: "Failed to generate suggestions" }, { status: 500 });
  }
}
