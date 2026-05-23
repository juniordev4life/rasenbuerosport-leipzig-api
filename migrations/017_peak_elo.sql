-- Migration 017: Lifetime peak ELO on profiles.
--
-- `rating_history` is trimmed to the last 30 ratings, so reading the
-- peak from it only surfaces a "recent peak". For the lifetime stats
-- card on the player profile we want the true all-time high.
--
-- Two new columns on `profiles`:
--   * `peak_elo_value` — the highest `current_rating` the player has
--     ever held after a match. Mirrors the integer scale of
--     `current_rating`.
--   * `peak_elo_at`    — `played_at` of the game that produced the
--     peak. Nullable until the first match is played.
--
-- Both columns are additive — no existing row is broken. The
-- `peak_elo_value` defaults to 1500 (same baseline as
-- `current_rating`) so the lifetime-stats card always has a value to
-- show.
--
-- A one-off `UPDATE` seeds the peak from `current_rating` for
-- existing profiles. Players with a `rating_history` already on
-- record will get a more accurate seed via the
-- `scripts/recompute-all-elo.js` backfill, which is the recommended
-- prod-cutover step.

ALTER TABLE profiles
	ADD COLUMN IF NOT EXISTS peak_elo_value INTEGER NOT NULL DEFAULT 1500,
	ADD COLUMN IF NOT EXISTS peak_elo_at TIMESTAMPTZ;

-- Seed: anyone whose current rating is higher than the freshly added
-- default sees it lift to that rating, so the column already reflects
-- the live data when this migration runs against an existing DB.
UPDATE profiles
   SET peak_elo_value = GREATEST(peak_elo_value, current_rating)
 WHERE current_rating IS NOT NULL;
