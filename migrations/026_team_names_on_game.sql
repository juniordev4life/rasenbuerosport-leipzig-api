-- Migration 026: Team names on the game row
--
-- The app rolls/picks both in-game teams in the poster step BEFORE kickoff —
-- including the opponent side in 1vsCPU matches. Until now the names were
-- persisted only via game_players.team_name, so a side with zero human
-- players (CPU) lost its team entirely and the app rendered a "?" crest.
--
-- The app now sends both names at game creation; sides with players keep
-- their game_players.team_name as the primary source, these columns are the
-- fallback (and the only carrier for CPU sides).

ALTER TABLE games ADD COLUMN IF NOT EXISTS home_team_name TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS away_team_name TEXT;
