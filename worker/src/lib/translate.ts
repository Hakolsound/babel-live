import { anthropic } from './anthropic';
import type { EventKnowledge } from '../types';
export type { EventKnowledge };

const MODEL = 'claude-haiku-4-5-20251001';
const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';

export async function translateText(opts: {
  text: string;
  sourceLang: string;
  targetLang: string;
  priorContext: string[];
  translatedContext: string[];
  glossary: Record<string, string>;
  knowledge: EventKnowledge | null;
  topicSummary?: string;
  model?: string;
}): Promise<string> {
  const { text, sourceLang, targetLang, priorContext, translatedContext, glossary, knowledge, topicSummary } = opts;

  if (!text.trim()) return '';

  const glossaryBlock = Object.keys(glossary).length > 0
    ? `\nDomain-specific terms to preserve:\n${Object.entries(glossary).map(([k, v]) => `  ${k} → ${v}`).join('\n')}`
    : '';

  // Build source→translation pair context so the model sees what it already committed to
  const contextBlock = priorContext.length > 0
    ? `Prior utterances (source → your ${targetLang} translation):\n${
        priorContext.map((src, i) => {
          const tgt = translatedContext[i];
          return tgt ? `  • "${src}" → "${tgt}"` : `  • "${src}"`;
        }).join('\n')
      }\n\n`
    : '';

  const summaryBlock = topicSummary
    ? `\nSESSION SUMMARY (what has been discussed so far — use for context, do not translate):\n${topicSummary}`
    : '';

  const knowledgeBlock = buildKnowledgeBlock(knowledge);
  const termOverridesBlock = buildTermOverridesBlock(knowledge, targetLang);

  const system = `You are a professional live interpreter. Translate spoken text from ${sourceLang} to ${targetLang}.
Rules:
- Output ONLY the translated text in ${targetLang}. No explanations, no meta-commentary, no quotes, no self-corrections.
- NEVER switch to another language mid-output. If you catch yourself writing anything other than ${targetLang}, stop and output only what you have so far in ${targetLang}.
- If the input is empty, a single punctuation mark, or not meaningful speech, output nothing (empty string).
- Preserve the speaker's tone and register.
- Keep proper nouns, acronyms, and brand names as-is unless a glossary entry overrides them.
- Use the prior utterances to resolve pronouns, references, and topic continuity.
- Filler words and sounds (uh, um, you know, I mean, sort of, like, right?) — omit them silently in the translation.
- "Mm-hmm" or "Mm" at the start of an utterance means affirmation — render as a brief natural affirmative in ${targetLang} (e.g. "כן," / "Sí,") then continue, or omit if it stands alone.
- False starts and self-corrections (e.g. "I, I, I think") — render once cleanly ("I think").${summaryBlock}${knowledgeBlock}${termOverridesBlock}${glossaryBlock}`;

  const userMsg = `${contextBlock}Translate this utterance:\n${text}`;

  const response = await anthropic.messages.create({
    model: opts.model ?? MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });

  const block = response.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('Unexpected response from Claude');
  }
  return block.text.trim();
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
  temperature?: number;
  onPartial: (accumulated: string) => void;
}): Promise<string> {
  const { onPartial, ...rest } = opts;
  const { text, sourceLang, targetLang, priorContext, translatedContext, glossary, knowledge, topicSummary } = rest;

  if (!text.trim()) return '';

  const glossaryBlock = Object.keys(glossary).length > 0
    ? `\nDomain-specific terms to preserve:\n${Object.entries(glossary).map(([k, v]) => `  ${k} → ${v}`).join('\n')}`
    : '';

  const contextBlock = priorContext.length > 0
    ? `Prior utterances (source → your ${targetLang} translation):\n${
        priorContext.map((src, i) => {
          const tgt = translatedContext[i];
          return tgt ? `  • "${src}" → "${tgt}"` : `  • "${src}"`;
        }).join('\n')
      }\n\n`
    : '';

  const summaryBlock = topicSummary
    ? `\nSESSION SUMMARY (what has been discussed so far — use for context, do not translate):\n${topicSummary}`
    : '';

  const knowledgeBlock = buildKnowledgeBlock(knowledge);
  const termOverridesBlock = buildTermOverridesBlock(knowledge, targetLang);

  const system = `You are a professional live interpreter. Translate spoken text from ${sourceLang} to ${targetLang}.
Rules:
- Output ONLY the translated text in ${targetLang}. No explanations, no meta-commentary, no quotes, no self-corrections.
- NEVER switch to another language mid-output. If you catch yourself writing anything other than ${targetLang}, stop and output only what you have so far in ${targetLang}.
- If the input is empty, a single punctuation mark, or not meaningful speech, output nothing (empty string).
- Preserve the speaker's tone and register.
- Keep proper nouns, acronyms, and brand names as-is unless a glossary entry overrides them.
- Use the prior utterances to resolve pronouns, references, and topic continuity.
- Filler words and sounds (uh, um, you know, I mean, sort of, like, right?) — omit them silently in the translation.
- "Mm-hmm" or "Mm" at the start of an utterance means affirmation — render as a brief natural affirmative in ${targetLang} (e.g. "כן," / "Sí,") then continue, or omit if it stands alone.
- False starts and self-corrections (e.g. "I, I, I think") — render once cleanly ("I think").${summaryBlock}${knowledgeBlock}${termOverridesBlock}${glossaryBlock}`;

  const userMsg = `${contextBlock}Translate this utterance:\n${text}`;

  let accumulated = '';
  const streamParams: Parameters<typeof anthropic.messages.stream>[0] = {
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: userMsg }],
  };
  if (opts.temperature !== undefined) streamParams.temperature = opts.temperature;
  const stream = anthropic.messages.stream(streamParams);

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      accumulated += event.delta.text;
      // Emit on word boundary for clean word-by-word viewer effect
      if (/[\s,;:!?.،。،]$/.test(accumulated)) {
        onPartial(accumulated.trimEnd());
      }
    }
  }

  const final = accumulated.trim();
  if (final) onPartial(final); // always emit final state
  return final;
}

/**
 * Generates a 2–3 sentence summary of what has been discussed so far.
 * Called asynchronously every N utterances — never blocks translation.
 */
export async function generateTopicSummary(recentUtterances: string[], existingSummary: string): Promise<string> {
  const historyBlock = recentUtterances.map((u, i) => `${i + 1}. ${u}`).join('\n');
  const priorBlock = existingSummary
    ? `Previous summary: ${existingSummary}\n\n`
    : '';

  const response = await anthropic.messages.create({
    model: SUMMARY_MODEL,
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

function buildKnowledgeBlock(knowledge: EventKnowledge | null): string {
  if (!knowledge) return '';

  const parts: string[] = [];

  const domainParts = [knowledge.domain, knowledge.subdomain, knowledge.specialty]
    .filter(Boolean)
    .join(' › ');
  if (domainParts) parts.push(`EVENT DOMAIN: ${domainParts}`);

  if (knowledge.briefing) {
    parts.push(`EVENT BRIEFING: ${knowledge.briefing}`);
  }

  if (knowledge.keyterms.length > 0) {
    parts.push(
      `KEY TERMS (must not be translated — keep exactly as spoken):\n${knowledge.keyterms.map((t) => `  - ${t}`).join('\n')}`
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
    .filter(Boolean);
  if (overrides.length === 0) return '';
  return `\nTERM TRANSLATION OVERRIDES (use these exact forms in ${targetLang}):\n${overrides.join('\n')}`;
}
