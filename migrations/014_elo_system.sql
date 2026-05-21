-- Migration 014: Contribution-weighted ELO system.
--
-- Re-introduces ELO after the v1 system was rolled back in migration
-- 005. The new design persists ratings on the `profiles` row rather
-- than a separate `player_ratings` table, and stores the per-match
-- snapshot as JSONB on the `games` row instead of a parallel
-- `elo_history` table. This keeps lookups single-row and matches the
-- structure of related features (`match_stats`, `score_timeline`,
-- `home_pass_network` etc.) on the same table.
--
-- Columns are additive and nullable / defaulted; no data is lost on
-- rollback.

ALTER TABLE profiles
	ADD COLUMN IF NOT EXISTS current_rating INTEGER NOT NULL DEFAULT 1500,
	ADD COLUMN IF NOT EXISTS matches_played INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS rating_updated_at TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS rating_history JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE games
	ADD COLUMN IF NOT EXISTS elo_snapshot JSONB;

-- Leaderboard sort key — almost every query that touches ratings will
-- order by current_rating DESC.
CREATE INDEX IF NOT EXISTS idx_profiles_current_rating
	ON profiles (current_rating DESC);
