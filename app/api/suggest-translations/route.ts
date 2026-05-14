import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface SuggestedTranslations {
  /** { [term]: { [langCode]: suggestedTranslation | "" } } */
  translations: Record<string, Record<string, string>>;
}

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    terms?: string[];
    targetLangs?: string[];
    domain?: string;
    subdomain?: string;
    specialty?: string;
  };

  const { terms = [], targetLangs = [], domain = "", subdomain = "", specialty = "" } = body;

  if (terms.length === 0 || targetLangs.length === 0) {
    return NextResponse.json({ error: "terms and targetLangs required" }, { status: 400 });
  }

  const fieldStr = [domain, subdomain, specialty].filter(Boolean).join(" › ") || "General";
  const langList = targetLangs.join(", ");

  const prompt = `You are a professional simultaneous interpreter configuring a term translation table.

Field: ${fieldStr}
Target languages: ${langList}

For each term below, provide the correct form to use in each target language.
Rules:
- If the term should stay EXACTLY as-is in a language (e.g. brand names, universal acronyms), output ""
- If the term has a well-known localized form, provide it (e.g. drug trade names differ by country, eponyms may be spelled differently)
- If you are uncertain, output ""
- Keep translations short — these are spoken interpretations, not written text

Terms: ${terms.join(", ")}

Return ONLY valid JSON, no prose:
{
  "translations": {
    "<term>": { "<langCode>": "<translation or empty string>" }
  }
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0];
    if (!raw || raw.type !== "text") throw new Error("Unexpected Claude response");

    const cleaned = raw.text.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as SuggestedTranslations;

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[suggest-translations]", err);
    return NextResponse.json({ error: "Failed to generate translations" }, { status: 500 });
  }
}
