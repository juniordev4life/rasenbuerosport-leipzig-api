-- ============================================
-- RasenBürosport Leipzig - Supabase Migration
-- ============================================

-- Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Games table
CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('1v1', '2v2')),
  score_home INTEGER NOT NULL DEFAULT 0,
  score_away INTEGER NOT NULL DEFAULT 0,
  played_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Game players (junction table)
CREATE TABLE IF NOT EXISTS public.game_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team TEXT NOT NULL CHECK (team IN ('home', 'away')),
  UNIQUE(game_id, player_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_games_played_at ON public.games(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_created_by ON public.games(created_by);
CREATE INDEX IF NOT EXISTS idx_game_players_player_id ON public.game_players(player_id);
CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON public.game_players(game_id);

-- ============================================
-- Row Level Security
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read, users can update their own
CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Games: anyone authenticated can read, authenticated users can create
CREATE POLICY "Games are viewable by authenticated users"
  ON public.games FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create games"
  ON public.games FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- Game players: anyone authenticated can read, system can insert
CREATE POLICY "Game players are viewable by authenticated users"
  ON public.game_players FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can add game players"
  ON public.game_players FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================
-- Auto-create profile on user signup
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'username');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
