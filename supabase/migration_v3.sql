-- ============================================
-- RasenBürosport Leipzig - Migration V3
-- Change team_name from UUID to TEXT
-- ============================================

-- Drop the foreign key constraint
ALTER TABLE public.game_players
  DROP CONSTRAINT IF EXISTS game_players_team_name_fkey;

-- Change column type from UUID to TEXT
ALTER TABLE public.game_players
  ALTER COLUMN team_name TYPE TEXT USING team_name::TEXT;

-- The teams table is no longer needed for game creation
-- (keeping it for reference but it's not used anymore)
