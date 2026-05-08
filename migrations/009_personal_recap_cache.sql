-- Migration 009: Daily cache for personal weekly recaps.
--
-- The dashboard renders a live AI-narrated weekly recap on every load,
-- which would otherwise hit Anthropic on every fetch (~30-50 calls/day
-- for a small office). We cache the generated payload per player per
-- Berlin calendar day — at most one Anthropic call per player per day,
-- regenerated when the Berlin date rolls over at 00:00.
--
-- Schema is intentionally one-row-per-player (not a per-day history)
-- because we never need yesterday's recap; the latest valid-for-today
-- entry is enough.

CREATE TABLE IF NOT EXISTS personal_recap_cache (
	player_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
	valid_for_date DATE NOT NULL,
	payload JSONB NOT NULL,
	generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_recap_cache_valid_for_date
	ON personal_recap_cache (valid_for_date);
