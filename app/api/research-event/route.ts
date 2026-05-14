import { NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { serpWebSearch, serpYouTubeSearch } from '@/lib/serpapi';
import { YoutubeTranscript } from 'youtube-transcript';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ResearchEvent =
  | { type: 'progress'; step: string; message: string }
  | { type: 'complete'; result: ResearchResult }
  | { type: 'error'; message: string };

export interface ResearchKeyterm {
  term: string;
  tier: 'core' | 'common' | 'advanced' | 'rare';
  reason: string;
  source: 'transcript' | 'web' | 'inferred';
}

export interface ResearchResult {
  domain: string;
  subdomain: string;
  specialty: string;
  briefing: string;
  keyterms: ResearchKeyterm[];
  sources: Array<{ type: 'web' | 'youtube'; title: string; url: string }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; event-research-bot/1.0)' },
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) return '';
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3_500);
  } catch {
    return '';
  }
}

async function fetchYouTubeTranscript(link: string): Promise<string> {
  try {
    const videoId = new URL(link).searchParams.get('v');
    if (!videoId) return '';
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    return segments
      .map((s: { text: string }) => s.text)
      .join(' ')
      .slice(0, 6_000);
  } catch {
    return '';
  }
}

async function synthesize(opts: {
  eventName: string;
  organization: string;
  webResults: Awaited<ReturnType<typeof serpWebSearch>>;
  pageTexts: string[];
  ytResults: Awaited<ReturnType<typeof serpYouTubeSearch>>;
  transcripts: string[];
}): Promise<ResearchResult> {
  const { eventName, organization, webResults, pageTexts, ytResults, transcripts } = opts;

  const webSnippets = webResults
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
    .join('\n\n');

  const pageContent = pageTexts
    .map((t, i) => t ? `--- Page ${i + 1} (${webResults[i]?.link ?? ''}) ---\n${t}` : '')
    .filter(Boolean)
    .join('\n\n');

  const ytContent = ytResults
    .map((v, i) => {
      const transcript = transcripts[i] ?? '';
      const header = `--- YouTube: "${v.title}" ---`;
      const desc = v.description ? `Description: ${v.description}\n` : '';
      const tx = transcript ? `Transcript excerpt:\n${transcript}` : '(no transcript available)';
      return `${header}\n${desc}${tx}`;
    })
    .join('\n\n');

  const orgLine = organization ? `Organization: "${organization}"` : '';

  const DOMAINS = [
    'Technology', 'Medical / Healthcare', 'Legal', 'Finance', 'Science',
    'Engineering', 'Education', 'Business & Management', 'Media & Entertainment',
    'Government & Policy', 'Sports', 'Arts & Culture',
  ];

  const prompt = `You are configuring a real-time AI interpreter for a live event. Research materials are below.

Event: "${eventName}"
${orgLine}

=== WEB SEARCH SNIPPETS ===
${webSnippets || '(none)'}

=== FULL PAGE CONTENT ===
${pageContent || '(none)'}

=== YOUTUBE RECORDINGS ===
${ytContent || '(none)'}

Extract interpreter configuration from this research:

1. Domain — pick EXACTLY one from this list: ${DOMAINS.map(d => `"${d}"`).join(', ')}
2. Subdomain — a more specific field within the domain (e.g. "Dermatology", "DevOps", "Corporate Law")
3. Specialty — the narrowest focus area of this particular event
4. A 2–3 sentence briefing for the interpreter describing the event context
5. 25–35 key terms a translation AI would mistranslate, corrupt, or over-translate:
   - Eponyms and proper technique names (must stay in original form)
   - Field-specific acronyms
   - Speaker names found in research
   - Brand/product/drug names
   - Latin/Greek clinical or technical terms with translation traps
   - Newly coined or niche jargon

Tier rules:
- core: every talk in this field uses this term
- common: most talks use it
- advanced: expert-level content only
- rare: highly specific subfield or cutting-edge

Source rules:
- transcript: found in YouTube transcript
- web: found in web page / snippet
- inferred: derived from domain knowledge given the field

Return ONLY valid JSON, no prose, no markdown:
{
  "domain": "one of the listed domain values",
  "subdomain": "string",
  "specialty": "string",
  "briefing": "string",
  "keyterms": [{"term":"string","tier":"core|common|advanced|rare","reason":"string","source":"transcript|web|inferred"}]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3_000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0];
  if (!raw || raw.type !== 'text') throw new Error('Unexpected Claude response');

  const cleaned = raw.text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const parsed = JSON.parse(cleaned) as Omit<ResearchResult, 'sources'>;

  const sources: ResearchResult['sources'] = [
    ...webResults.slice(0, 3).map((r) => ({ type: 'web' as const, title: r.title, url: r.link })),
    ...ytResults
      .filter((_, i) => (transcripts[i]?.length ?? 0) > 0)
      .map((r) => ({ type: 'youtube' as const, title: r.title, url: r.link })),
  ];

  return { ...parsed, sources };
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await request.json() as { eventName?: string; organization?: string };
  const eventName = (body.eventName ?? '').trim();
  const organization = (body.organization ?? '').trim();

  if (!eventName) {
    return new Response('eventName is required', { status: 400 });
  }

  const query = organization ? `"${eventName}" "${organization}"` : `"${eventName}"`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: ResearchEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        // Step 1: parallel web + YouTube search
        emit({ type: 'progress', step: 'searching', message: `Searching for "${eventName}"…` });
        const [webResults, ytResults] = await Promise.all([
          serpWebSearch(query).catch(() => []),
          serpYouTubeSearch(query).catch(() => []),
        ]);
        emit({
          type: 'progress',
          step: 'found',
          message: `Found ${webResults.length} web pages, ${ytResults.length} videos`,
        });

        // Step 2: parallel page fetch + transcript fetch
        emit({ type: 'progress', step: 'fetching', message: 'Reading pages and transcripts…' });
        const [pageTexts, transcripts] = await Promise.all([
          Promise.all(webResults.slice(0, 3).map((r) => fetchPageText(r.link))),
          Promise.all(ytResults.slice(0, 3).map((r) => fetchYouTubeTranscript(r.link))),
        ]);
        const transcriptCount = transcripts.filter((t) => t.length > 0).length;
        const wordCount = transcripts.reduce((n, t) => n + t.split(' ').length, 0);
        emit({
          type: 'progress',
          step: 'fetched',
          message: `Read ${pageTexts.filter((t) => t.length > 0).length} pages${transcriptCount > 0 ? `, ${transcriptCount} transcript${transcriptCount > 1 ? 's' : ''} (${wordCount.toLocaleString()} words)` : ''}`,
        });

        // Step 3: synthesize
        emit({ type: 'progress', step: 'synthesizing', message: 'Extracting knowledge with AI…' });
        const result = await synthesize({ eventName, organization, webResults, pageTexts, ytResults, transcripts });

        emit({ type: 'complete', result });
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Research failed' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
