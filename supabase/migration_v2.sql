-- ============================================
-- RasenBürosport Leipzig - Migration V2
-- Teams, Ratings & Game Player Extensions
-- ============================================

-- Teams table (Bundesliga clubs)
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  short_name TEXT,
  logo_url TEXT
);

-- Seed Bundesliga teams
INSERT INTO public.teams (name, short_name) VALUES
  ('RB Leipzig', 'RBL'),
  ('Bayern München', 'FCB'),
  ('Borussia Dortmund', 'BVB'),
  ('Bayer 04 Leverkusen', 'B04'),
  ('VfB Stuttgart', 'VFB'),
  ('Eintracht Frankfurt', 'SGE'),
  ('VfL Wolfsburg', 'WOB'),
  ('SC Freiburg', 'SCF'),
  ('TSG Hoffenheim', 'TSG'),
  ('1. FC Union Berlin', 'FCU'),
  ('Werder Bremen', 'SVW'),
  ('1. FSV Mainz 05', 'M05'),
  ('Borussia Mönchengladbach', 'BMG'),
  ('FC Augsburg', 'FCA'),
  ('1. FC Heidenheim', 'FCH'),
  ('SV Darmstadt 98', 'D98'),
  ('1. FC Köln', 'KOE'),
  ('Holstein Kiel', 'KSV')
ON CONFLICT (name) DO NOTHING;

-- Extend game_players with team_name and rating
ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS team_name UUID REFERENCES public.teams(id),
  ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating >= 1 AND rating <= 5);

-- RLS for teams
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams are viewable by everyone"
  ON public.teams FOR SELECT
  USING (true);
