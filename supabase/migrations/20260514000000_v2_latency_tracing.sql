-- Migration: 20260514000000_v2_latency_tracing.sql
-- Phase 2 v2: per-utterance latency tracing for translation pipeline observability.

CREATE TABLE IF NOT EXISTS translation_latency_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  utterance_id     text        NOT NULL,
  language_code    text,
  engine           text        NOT NULL,   -- 'legacy_text' | 'realtime_translate' | 'realtime_stt_text'
  stage            text        NOT NULL,   -- 'summary' | individual stage name
  timestamp_ms     bigint      NOT NULL,
  metadata         jsonb,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_latency_events_event_id
  ON translation_latency_events(event_id);

CREATE INDEX IF NOT EXISTS idx_latency_events_utterance_id
  ON translation_latency_events(utterance_id);

ALTER TABLE translation_latency_events ENABLE ROW LEVEL SECURITY;

-- Only the event creator can read latency data
CREATE POLICY "latency_events_read_owner"
  ON translation_latency_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
        AND events.creator_id = auth.uid()
    )
  );

-- Service role inserts from worker (no auth)
CREATE POLICY "latency_events_insert_service"
  ON translation_latency_events FOR INSERT
  WITH CHECK (true);
