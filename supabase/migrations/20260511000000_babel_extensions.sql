-- Migration: 20260511000000_babel_extensions.sql
-- Extends captions.events schema with Babel translation/audio pipeline fields

-- ─── 1. Extend events table ───────────────────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS source_language  text    DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS target_languages text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS event_code       text    UNIQUE,        -- 6-char QR join code
  ADD COLUMN IF NOT EXISTS tts_enabled      boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS glossary         jsonb   DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fly_region       text;                  -- owning Fly.io region (e.g. 'ams')

-- Fast lookup by QR code
CREATE INDEX IF NOT EXISTS idx_events_event_code ON events(event_code);

-- ─── 2. Per-language pipeline state ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS language_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  language_code    text        NOT NULL,
  started_at       timestamptz DEFAULT now(),
  ended_at         timestamptz,
  peak_listeners   int         DEFAULT 0,
  total_audio_ms   bigint      DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_language_sessions_event_id
  ON language_sessions(event_id);

ALTER TABLE language_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "language_sessions_select_all"
  ON language_sessions FOR SELECT USING (true);

CREATE POLICY "language_sessions_write_owner"
  ON language_sessions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
        AND events.creator_id = auth.uid()
    )
  );

-- ─── 3. Full transcript log (source + all translations) ───────────────────────

CREATE TABLE IF NOT EXISTS transcript_entries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  language_code text        NOT NULL,   -- 'source' | ISO-639-1 code
  text          text        NOT NULL,
  timestamp_ms  bigint      NOT NULL,   -- ms since event start
  is_final      boolean     DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcript_entries_event_ts
  ON transcript_entries(event_id, timestamp_ms);

ALTER TABLE transcript_entries ENABLE ROW LEVEL SECURITY;

-- Viewers can read (caption sidecar, Phase 5)
CREATE POLICY "transcript_entries_select_all"
  ON transcript_entries FOR SELECT USING (true);

-- Next.js API routes insert with user auth context
CREATE POLICY "transcript_entries_insert_owner"
  ON transcript_entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
        AND events.creator_id = auth.uid()
    )
  );

-- Worker uses service_role key → bypasses RLS entirely, no policy needed for it

-- Enable Supabase Realtime (viewer caption sidecar in Phase 5)
ALTER PUBLICATION supabase_realtime ADD TABLE transcript_entries;
