-- Migration 011: Multi-reporter system for the AI match report.
--
-- Every match report is now narrated by one of three reporter
-- personas — `klassiker`, `analyst`, or `euphoriker`. The chosen
-- reporter drives both the text generation (persona-specific prompt
-- fragment) and the TTS step (persona-specific ElevenLabs voice +
-- settings).
--
-- The column is nullable so legacy reports (generated before this
-- migration with the single-reporter prompt) keep working — they
-- simply do not show a reporter label in the UI.

ALTER TABLE games
	ADD COLUMN IF NOT EXISTS reporter_id TEXT
	CHECK (reporter_id IS NULL OR reporter_id IN ('klassiker', 'analyst', 'euphoriker'));

-- Anti-repetition queries fetch the most recent two non-null
-- `reporter_id` values ordered by `played_at`. The partial index makes
-- that lookup cheap even as the table grows.
CREATE INDEX IF NOT EXISTS idx_games_reporter_id_played_at
	ON games (played_at DESC)
	WHERE reporter_id IS NOT NULL;
