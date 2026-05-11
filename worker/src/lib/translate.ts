import { anthropic } from './anthropic';

const MODEL = 'claude-haiku-4-5-20251001';

export async function translateText(opts: {
  text: string;
  sourceLang: string;
  targetLang: string;
  priorContext: string[];       // last ≤2 source utterances
  glossary: Record<string, string>;
}): Promise<string> {
  const { text, sourceLang, targetLang, priorContext, glossary } = opts;

  const glossaryBlock = Object.keys(glossary).length > 0
    ? `\nDomain-specific terms to preserve:\n${Object.entries(glossary).map(([k, v]) => `  ${k} → ${v}`).join('\n')}`
    : '';

  const contextBlock = priorContext.length > 0
    ? `\nPrior context (already translated — do not re-translate):\n${priorContext.map((u) => `  • ${u}`).join('\n')}`
    : '';

  const system = `You are a professional live interpreter. Translate spoken text from ${sourceLang} to ${targetLang}.
Rules:
- Output ONLY the translation. No explanations, no notes, no quotes.
- Preserve the speaker's tone and register.
- Keep proper nouns, acronyms, and brand names as-is unless a glossary entry overrides them.${glossaryBlock}`;

  const userMsg = `${contextBlock}\n\nTranslate this utterance:\n${text}`;

  const response = await anthropic.messages.create({
    model: MODEL,
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
