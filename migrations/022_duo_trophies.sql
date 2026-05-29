-- Migration 022: Duo trophies table
--
-- Per-pair storage for the duo-scope trophies (DU1 / DU2 / DU3 / DU5).
-- Each row is a sorted pair (player1_id < player2_id, enforced by the
-- CHECK) so we never end up with both (a, b) and (b, a) entries. The
-- trophies map mirrors the per-player JSONB on `profiles.trophies`:
--
--   {
--     "DU1": {
--       "unlocked_at": "2026-05-29T09:00:00Z",
--       "triggered_by_match_id": "<uuid>" | null,
--       "backfilled": true | false
--     },
--     ...
--   }
--
-- The cascade on profile delete keeps the row count clean if a player
-- is ever removed — duo trophies have no meaning without both halves.

CREATE TABLE IF NOT EXISTS duo_trophies (
  player1_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  player2_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  trophies JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (player1_id, player2_id),
  CHECK (player1_id < player2_id)
);

-- Helpful when looking up all duos a single player is part of.
CREATE INDEX IF NOT EXISTS idx_duo_trophies_player2 ON duo_trophies (player2_id);
