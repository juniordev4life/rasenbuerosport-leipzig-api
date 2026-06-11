-- Migration 023: Office recording agent
--
-- Wires the EA-FC capture agent (rasenbuerosport-leipzig-capture,
-- `office_agent.py`) into the API. Two pieces:
--
-- 1. `recording_command` — a single-row command slot the office agent
--    polls via GET /v1/recording/next. The app overwrites it on kickoff
--    ("start", carrying a client-generated provisional recording id —
--    the real game row does not exist until after the final whistle)
--    and after saving ("stop", carrying the real game id). The slot is
--    overwrite-only and never consumed: the agent treats repeated
--    commands as no-ops ("start" while recording / "stop" while idle).
--
-- 2. `games` video columns — written by the agent and (later) the
--    highlight pipeline via PATCH /v1/games/:gameId (X-Agent-Secret):
--      recording_id   provisional capture id from the app; links the
--                     local file game_<recording_id>.mov to this row
--      video_status   'recording' | 'uploaded' | 'ready'
--      highlight_url  public URL of the finished highlight reel — the
--                     app renders exactly this URL, no file lookups

CREATE TABLE IF NOT EXISTS recording_command (
	id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
	action TEXT NOT NULL CHECK (action IN ('start', 'stop')),
	game_id TEXT NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE games ADD COLUMN IF NOT EXISTS recording_id TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS video_status TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS highlight_url TEXT;
