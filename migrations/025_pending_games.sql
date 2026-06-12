-- Migration 025: Pending games (zero-tracking flow)
--
-- When nobody taps goals during a match, the app saves the game as PENDING:
-- 0:0, empty timeline, no ELO. The capture pipeline then extracts the real
-- timeline from the recording (events screen) and finalizes the game via
-- POST /v1/recording/finalize — which writes score + timeline, flips
-- pending off, and runs the deferred scoring (ELO, profile cache, push).
--
-- While pending (typically the few minutes the pipeline runs), the game is
-- visible with 0:0 — acceptable for the office app; stats self-heal on
-- finalize. ELO is the one thing that must NOT run early, hence the flag.

ALTER TABLE games ADD COLUMN IF NOT EXISTS pending BOOLEAN NOT NULL DEFAULT false;
