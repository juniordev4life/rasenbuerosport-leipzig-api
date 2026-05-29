-- Migration 021: Trophies JSONB column on profiles
--
-- The trophy system tracks 64 named achievements per player. Storing
-- them as a JSONB map on the existing `profiles` row (vs a separate
-- `player_trophies` table) keeps reads cheap — the trophy room is
-- one SELECT, no JOIN — and the cardinality is capped at 64 entries
-- per player, so the row stays small.
--
-- Shape:
--   {
--     "S1": {
--       "unlocked_at": "2026-05-29T08:30:00Z",
--       "triggered_by_match_id": "<uuid>" | null,
--       "backfilled": true | false
--     },
--     "S4": { ... },
--     ...
--   }
--
-- NULL means "no trophies yet" — the default for every existing row.
-- Trophy IDs live in `src/constants/trophies.constants.js`; condition
-- logic lives in `src/api/services/trophyConditions.services.js`.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trophies JSONB;
