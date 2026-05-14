/**
 * Resolve the correct worker WebSocket URL for an event.
 *
 * On Fly.io, each regional worker is at NEXT_PUBLIC_WORKER_URL_<REGION>.
 * Falls back to NEXT_PUBLIC_WORKER_URL (default) when no region-specific
 * URL is configured (local dev, unknown region, etc.).
 */
export function resolveWorkerUrl(flyRegion: string | null | undefined): string {
  const fallback = process.env.NEXT_PUBLIC_WORKER_URL ?? 'ws://localhost:3002';

  if (!flyRegion) return fallback;

  const key = `NEXT_PUBLIC_WORKER_URL_${flyRegion.toUpperCase()}`;
  return process.env[key] ?? fallback;
}
