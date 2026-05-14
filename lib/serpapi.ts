const BASE = 'https://serpapi.com/search.json';

export interface WebResult {
  title: string;
  link: string;
  snippet: string;
}

export interface YouTubeResult {
  title: string;
  link: string;
  description?: string;
}

export async function serpWebSearch(query: string): Promise<WebResult[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error('SERPAPI_KEY not configured');

  const url = new URL(BASE);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('num', '6');
  url.searchParams.set('api_key', key);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`SerpAPI web search failed: ${res.status}`);
  const data = await res.json() as { organic_results?: WebResult[] };
  return data.organic_results?.slice(0, 5) ?? [];
}

export async function serpYouTubeSearch(query: string): Promise<YouTubeResult[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error('SERPAPI_KEY not configured');

  const url = new URL(BASE);
  url.searchParams.set('engine', 'youtube');
  url.searchParams.set('search_query', query);
  url.searchParams.set('api_key', key);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`SerpAPI YouTube search failed: ${res.status}`);
  const data = await res.json() as { video_results?: YouTubeResult[] };
  return data.video_results?.slice(0, 4) ?? [];
}
