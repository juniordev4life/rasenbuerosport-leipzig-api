-- Migration 008: Drop the unused `game_players.rating` column
--
-- Background: the column has been on the table since the very first
-- migration as scaffolding for a "rate teammate / opponent" feature that
-- was never built. The frontend never sends a rating, the API never reads
-- it back, and the column is NULL in every row. Cleaning it up so the
-- schema reflects what is actually used.

ALTER TABLE game_players DROP COLUMN IF EXISTS rating;
