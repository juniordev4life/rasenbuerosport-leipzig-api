-- Migration 019: Extend the `games.mode` CHECK constraint to support
-- asymmetric and larger lineups.
--
-- Historical context:
--   - 001_init.sql created `mode TEXT NOT NULL CHECK (mode IN ('1v1', '2v2'))`.
--   - The API JSON schema was later extended to also accept '2v1' and '1v2',
--     but the matching DB constraint was never updated. As a result, every
--     attempt to save a 3-player match (1v2 / 2v1) failed at INSERT time with
--     a `check_violation` and the API returned a generic 400 — making the
--     bug hard to spot.
--
-- This migration brings the DB in sync with the product spec: 1v1, 1v2, 2v1,
-- 2v2, 2v3, 3v2, 3v3.

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_mode_check;

ALTER TABLE games
	ADD CONSTRAINT games_mode_check
	CHECK (mode IN ('1v1', '1v2', '2v1', '2v2', '2v3', '3v2', '3v3'));
