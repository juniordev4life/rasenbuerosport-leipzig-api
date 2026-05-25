-- Migration 018: Spoken-language aliases per player.
--
-- Office foosball league has long-standing real-name nicknames that
-- don't match the in-app username (e.g. "BlackIVmaniac" is "Dirk" when
-- people talk about him). The live-match voice tracker feeds these
-- aliases to Claude so it can resolve a spoken first name back to the
-- right `player_id` even when nobody ever says the actual username.
--
-- One small JSONB column on `profiles`, defaulting to an empty array.
-- The shape is a flat array of strings: `["Dirk", "DBL"]`. Owners
-- maintain their own list through the existing PATCH /v1/auth/profile
-- endpoint; no admin permission needed because the data is purely
-- spoken-form metadata.
--
-- Additive and non-destructive.

ALTER TABLE profiles
	ADD COLUMN IF NOT EXISTS voice_aliases JSONB NOT NULL DEFAULT '[]'::jsonb;
