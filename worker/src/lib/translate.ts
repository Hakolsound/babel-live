import { anthropic } from './anthropic';
import type { EventKnowledge, TranslationPromptProfile } from '../types';
export type { EventKnowledge };

// ── Model config ──────────────────────────────────────────────────────────────

const HAIKU = 'claude-haiku-4-5-20251001';

// Active prompt profile — controlled by env var, default balanced_live
const LIVE_PROFILE: TranslationPromptProfile =
  (process.env.LIVE_PROMPT_PROFILE as TranslationPromptProfile | undefined) ?? 'balanced_live';

// ── Prompt profiles ───────────────────────────────────────────────────────────

/**
 * fast_live: minimal prompt for lowest first-token latency.
 * No context history, no topic summary. Just domain + do-not-translate list.
 */
function buildFastLivePrompt(opts: {
  sourceLang: string;
  targetLang: string;
  knowledge: EventKnowledge | null;
  glossary: Record<string, string>;
}): { system: string; contextBlock: string } {
  const { sourceLang, targetLang, knowledge, glossary } = opts;

  const dntTerms = [
    ...(knowledge?.keyterms ?? []),
    ...Object.keys(glossary),
  ].slice(0, 30);

  const dntBlock = dntTerms.length > 0
    ? `\nDo not translate these terms — keep exactly as spoken:\n${dntTerms.map(t => `  - ${t}`).join('\n')}`
    : '';

  const termOverrides = buildTermOverridesBlock(knowledge, targetLang);

  const briefLine = knowledge?.briefing
    ? `\nEvent context: ${knowledge.briefing.split(/\.\s*/)[0] ?? knowledge.briefing}`
    : '';

  const system =
    `You are a professional live interpreter. Translate the spoken text from ${sourceLang} to ${targetLang}.
Output ONLY the translated text. No explanations. No quotes. No meta-commentary.
Preserve names, acronyms, brand names, and product names exactly unless an override is provided.
Use natural spoken language. Keep latency low.${briefLine}${dntBlock}${termOverrides}`;

  return { system, contextBlock: '' };
}

/**
 * balanced_live: current production profile.
 * Compact briefing, top-20 key terms, last 3 source + 2 translation pairs.
 */
function buildBalancedLivePrompt(opts: {
  sourceLang: string;
  targetLang: string;
  priorContext: string[];
  translatedContext: string[];
  glossary: Record<string, string>;
  knowledge: EventKnowledge | null;
  topicSummary?: string;
}): { system: string; contextBlock: string } {
  const { sourceLang, targetLang, priorContext, translatedContext, glossary, knowledge, topicSummary } = opts;

  const glossaryBlock = Object.keys(glossary).length > 0
    ? `\nDomain-specific terms to preserve:\n${Object.entries(glossary).map(([k, v]) => `  ${k} → ${v}`).join('\n')}`
    : '';

  const summaryBlock = topicSummary
    ? `\nSESSION SUMMARY (context only — do not translate):\n${topicSummary}`
    : '';

  const knowledgeBlock = buildKnowledgeBlock(knowledge, 20);
  const termOverridesBlock = buildTermOverridesBlock(knowledge, targetLang);

  const system =
    `You are a professional live interpreter. Translate spoken text from ${sourceLang} to ${targetLang}.
Rules:
- Output ONLY the translated text in ${targetLang}. No explanations, no meta-commentary, no quotes.
- NEVER switch to another language mid-output.
- If the input is empty, a single punctuation mark, or not meaningful speech, output nothing.
- Preserve the speaker's tone and register.
- Keep proper nouns, acronyms, and brand names as-is unless a glossary entry overrides them.
- Use prior utterances to resolve pronouns, references, and topic continuity.
- Omit filler words (uh, um, you know, I mean, sort of, like, right?) silently.
- "Mm-hmm" or "Mm" as affirmation — render as a brief natural affirmative in ${targetLang} or omit if standalone.
- False starts and self-corrections — render once cleanly.${summaryBlock}${knowledgeBlock}${termOverridesBlock}${glossaryBlock}`;

  const contextBlock = priorContext.length > 0
    ? `Prior utterances (source → your ${targetLang} translation):\n${
        priorContext.slice(-3).map((src, i) => {
          const tgt = translatedContext.slice(-3)[i];
          return tgt ? `  • "${src}" → "${tgt}"` : `  • "${src}"`;
        }).join('\n')
      }\n\n`
    : '';

  return { system, contextBlock };
}

/**
 * accurate_caption: post-event cleanup. Full briefing, full history, cleanup instructions.
 * Not used in the live streaming path.
 */
function buildAccurateCaptionPrompt(opts: {
  sourceLang: string;
  targetLang: string;
  priorContext: string[];
  translatedContext: string[];
  glossary: Record<string, string>;
  knowledge: EventKnowledge | null;
  topicSummary?: string;
}): { system: string; contextBlock: string } {
  const { sourceLang, targetLang, priorContext, translatedContext, glossary, knowledge, topicSummary } = opts;

  const glossaryBlock = Object.keys(glossary).length > 0
    ? `\nGlossary:\n${Object.entries(glossary).map(([k, v]) => `  ${k} → ${v}`).join('\n')}`
    : '';

  const summaryBlock = topicSummary
    ? `\nSESSION SUMMARY:\n${topicSummary}`
    : '';

  const knowledgeBlock = buildKnowledgeBlock(knowledge, Infinity);
  const termOverridesBlock = buildTermOverridesBlock(knowledge, targetLang);

  const system =
    `You are editing a live-interpreted transcript. Improve grammar, punctuation, terminology, and readability.
Do not change meaning. Preserve speaker intent. Apply glossary and event terminology strictly.
Translate from ${sourceLang} to ${targetLang}.
Return only the clean translated text.${summaryBlock}${knowledgeBlock}${termOverridesBlock}${glossaryBlock}`;

  const contextBlock = priorContext.length > 0
    ? `Prior utterances (source → ${targetLang}):\n${
        priorContext.map((src, i) => {
          const tgt = translatedContext[i];
          return tgt ? `  • "${src}" → "${tgt}"` : `  • "${src}"`;
        }).join('\n')
      }\n\n`
    : '';

  return { system, contextBlock };
}

// ── Profile dispatcher ────────────────────────────────────────────────────────

interface PromptOpts {
  sourceLang: string;
  targetLang: string;
  priorContext: string[];
  translatedContext: string[];
  glossary: Record<string, string>;
  knowledge: EventKnowledge | null;
  topicSummary?: string;
  profile: TranslationPromptProfile;
}

function buildPrompt(opts: PromptOpts): { system: string; contextBlock: string } {
  switch (opts.profile) {
    case 'fast_live':
      return buildFastLivePrompt(opts);
    case 'accurate_caption':
      return buildAccurateCaptionPrompt(opts);
    case 'balanced_live':
    default:
      return buildBalancedLivePrompt(opts);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function translateText(opts: {
  text: string;
  sourceLang: string;
  targetLang: string;
  priorContext: string[];
  translatedContext: string[];
  glossary: Record<string, string>;
  knowledge: EventKnowledge | null;
  topicSummary?: string;
  profile?: TranslationPromptProfile;
  model?: string;
}): Promise<string> {
  const { text, profile = LIVE_PROFILE, model } = opts;
  if (!text.trim()) return '';

  const { system, contextBlock } = buildPrompt({ ...opts, profile });
  const userMsg = `${contextBlock}Translate this utterance:\n${text}`;

  const response = await anthropic.messages.create({
    model: model ?? HAIKU,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });

  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('Unexpected response from Claude');
  return block.text.trim();
}

export interface StreamingTranslationResult {
  translated: string;
  firstTokenMs: number | null;
  totalMs: number;
}

export async function translateTextStreaming(opts: {
  text: string;
  sourceLang: string;
  targetLang: string;
  priorContext: string[];
  translatedContext: string[];
  glossary: Record<string, string>;
  knowledge: EventKnowledge | null;
  topicSummary?: string;
  profile?: TranslationPromptProfile;
  temperature?: number;
  onPartial: (accumulated: string) => void;
  onFirstToken?: () => void;
}): Promise<StreamingTranslationResult> {
  const { text, profile = LIVE_PROFILE, onPartial, onFirstToken } = opts;
  if (!text.trim()) return { translated: '', firstTokenMs: null, totalMs: 0 };

  const { system, contextBlock } = buildPrompt({ ...opts, profile });
  const userMsg = `${contextBlock}Translate this utterance:\n${text}`;

  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let accumulated = '';

  const streamParams: Parameters<typeof anthropic.messages.stream>[0] = {
    model: HAIKU,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: userMsg }],
  };
  if (opts.temperature !== undefined) streamParams.temperature = opts.temperature;

  const stream = anthropic.messages.stream(streamParams);

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      if (firstTokenAt === null) {
        firstTokenAt = Date.now();
        onFirstToken?.();
      }
      accumulated += event.delta.text;
      // Emit on word boundary for a clean word-by-word viewer effect
      if (/[\s,;:!?.،。،]$/.test(accumulated)) {
        onPartial(accumulated.trimEnd());
      }
    }
  }

  const final = accumulated.trim();
  if (final) onPartial(final);

  const totalMs = Date.now() - startedAt;
  const firstTokenMs = firstTokenAt !== null ? firstTokenAt - startedAt : null;

  if (process.env.LATENCY_TRACE_ENABLED === 'true') {
    console.log(
      `[translate] profile=${profile} lang=${opts.targetLang} ` +
      `tt1=${firstTokenMs ?? 'n/a'}ms ttl=${totalMs}ms ` +
      `prompt≈${(system.length + userMsg.length) / 4 | 0}tok`,
    );
  }

  return { translated: final, firstTokenMs, totalMs };
}

/**
 * Generates a 2–3 sentence summary of what has been discussed so far.
 * Called async every N utterances — never blocks translation.
 */
export async function generateTopicSummary(
  recentUtterances: string[],
  existingSummary: string,
): Promise<string> {
  const historyBlock = recentUtterances.map((u, i) => `${i + 1}. ${u}`).join('\n');
  const priorBlock = existingSummary ? `Previous summary: ${existingSummary}\n\n` : '';

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 256,
    system: 'You summarize spoken content from live events. Write 2–3 sentences in English capturing the current topic and key points. Be factual and concise. Output only the summary.',
    messages: [{
      role: 'user',
      content: `${priorBlock}Recent utterances:\n${historyBlock}\n\nWrite an updated summary.`,
    }],
  });

  const block = response.content[0];
  return (block?.type === 'text' ? block.text.trim() : '') || existingSummary;
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

function buildKnowledgeBlock(knowledge: EventKnowledge | null, maxTerms: number): string {
  if (!knowledge) return '';
  const parts: string[] = [];

  const domainParts = [knowledge.domain, knowledge.subdomain, knowledge.specialty]
    .filter(Boolean)
    .join(' › ');
  if (domainParts) parts.push(`EVENT DOMAIN: ${domainParts}`);
  if (knowledge.briefing) parts.push(`EVENT BRIEFING: ${knowledge.briefing}`);

  if (knowledge.keyterms.length > 0) {
    const terms = knowledge.keyterms.slice(0, maxTerms);
    parts.push(
      `KEY TERMS (keep exactly as spoken):\n${terms.map(t => `  - ${t}`).join('\n')}`,
    );
  }

  return parts.length > 0 ? `\n\n${parts.join('\n')}` : '';
}

export function buildTermOverridesBlock(
  knowledge: EventKnowledge | null,
  targetLang: string,
): string {
  if (!knowledge?.termTranslations) return '';
  const overrides = Object.entries(knowledge.termTranslations)
    .map(([term, langs]) => {
      const override = langs[targetLang];
      return override ? `  "${term}" → "${override}"` : null;
    })
    .filter((x): x is string => x !== null);
  if (overrides.length === 0) return '';
  return `\nTERM TRANSLATION OVERRIDES (use these exact forms in ${targetLang}):\n${overrides.join('\n')}`;
}
