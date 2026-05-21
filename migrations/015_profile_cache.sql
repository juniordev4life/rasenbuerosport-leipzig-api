-- Migration 015: Player-profile cache column.
--
-- The /players/:id/profile endpoint composes ~half a dozen
-- aggregations (six axes, archetype, relationships, top badges,
-- LLM bio). Recomputing all of that on every page view is
-- prohibitive — instead we cache the assembled snapshot on the
-- `profiles` row and invalidate it whenever the player touches a
-- new match (hook lives in `games.services.js → createGame`).
--
-- Cache shape (managed by application code, not enforced by DB):
-- {
--   "axes": { finisher, playmaker, clutch, consistency, discipline, winner },
--   "baseArchetype": "vollstrecker",
--   "bio": { adjective, bio, baseArchetype, matchCountAtGeneration, generatedAt, model },
--   "profileState": "frischling"|"im_aufbau"|"vollwertig",
--   "computedAt": "2026-05-21T...",
--   "computedFromMatchCount": 47
-- }
--
-- Nullable on purpose: a fresh profile row has no cache yet, and
-- the invalidation step nukes the field rather than rewriting it.

ALTER TABLE profiles
	ADD COLUMN IF NOT EXISTS profile_cache JSONB;
