-- Migration 010: Audio columns for the reporter-style match report.
--
-- `match_report` now stores the raw reporter-style text including
-- inline ElevenLabs audio directives in square brackets (e.g.
-- `[nachdenklich] Zwei zu vier.`). The API strips those tags from the
-- payload it returns to the client; the TTS endpoint reads the raw
-- column directly and forwards it to ElevenLabs.
--
-- A single mp3 is rendered per game and cached on Firebase Storage.
-- We store only the signed URL + timestamp, never the binary in
-- Postgres.

ALTER TABLE games
	ADD COLUMN IF NOT EXISTS match_report_audio_url TEXT,
	ADD COLUMN IF NOT EXISTS match_report_audio_generated_at TIMESTAMPTZ;
