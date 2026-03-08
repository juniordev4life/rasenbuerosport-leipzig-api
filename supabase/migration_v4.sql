-- ============================================
-- RasenBürosport Leipzig — Migration V4
-- Extend teams table with FC 26 data fields
-- (sofifa_id, overall_rating, star_rating, league_name, country_code)
-- ============================================

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS sofifa_id INTEGER UNIQUE,
  ADD COLUMN IF NOT EXISTS overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 99),
  ADD COLUMN IF NOT EXISTS star_rating NUMERIC(2,1) CHECK (star_rating >= 0.5 AND star_rating <= 5.0),
  ADD COLUMN IF NOT EXISTS league_name TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT;

-- Indexes for filtering and sorting
CREATE INDEX IF NOT EXISTS idx_teams_league ON public.teams(league_name);
CREATE INDEX IF NOT EXISTS idx_teams_country ON public.teams(country_code);
CREATE INDEX IF NOT EXISTS idx_teams_overall_rating ON public.teams(overall_rating DESC);
