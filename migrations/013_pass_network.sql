-- Migration 013: Pass-network indicators per match.
--
-- The Pässe screenshot contains two visual pass networks (one per
-- team) that the AI extractor now reads alongside the numeric stats.
-- Each network produces a small JSON document with two numeric
-- indicators (laterality, verticality) plus the central player and
-- the top 3 pass connections.
--
-- We deliberately keep these in their OWN columns rather than nested
-- inside `match_stats`, because they have a separate update path
-- (only the Pässe screenshot writes them) and they will be aggregated
-- in a later Duo-Profil feature where having dedicated columns keeps
-- the SQL clean.
--
-- Both columns are nullable — a freshly created game has no upload
-- yet, and even after upload the extractor may legitimately return
-- null if the network was not readable on the image.

ALTER TABLE games
	ADD COLUMN IF NOT EXISTS home_pass_network JSONB,
	ADD COLUMN IF NOT EXISTS away_pass_network JSONB;
