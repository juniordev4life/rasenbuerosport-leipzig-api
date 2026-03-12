-- RasenBürosport Leipzig - Cloud SQL Schema
-- Migration 001: Initial tables

-- Profiles
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Teams
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  short_name TEXT,
  logo_url TEXT,
  sofifa_id INTEGER UNIQUE,
  overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 99),
  star_rating NUMERIC(2,1) CHECK (star_rating >= 0.5 AND star_rating <= 5.0),
  league_name TEXT,
  country_code TEXT
);

CREATE INDEX idx_teams_league ON teams(league_name);
CREATE INDEX idx_teams_country ON teams(country_code);
CREATE INDEX idx_teams_overall_rating ON teams(overall_rating DESC);

-- Games
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('1v1', '2v2')),
  score_home INTEGER NOT NULL DEFAULT 0,
  score_away INTEGER NOT NULL DEFAULT 0,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score_timeline JSONB,
  result_type TEXT DEFAULT 'regular',
  match_stats JSONB,
  match_report TEXT,
  stats_image_url TEXT,
  passes_image_url TEXT,
  defense_image_url TEXT
);

CREATE INDEX idx_games_played_at ON games(played_at DESC);
CREATE INDEX idx_games_created_by ON games(created_by);

-- Game Players
CREATE TABLE game_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team TEXT NOT NULL CHECK (team IN ('home', 'away')),
  team_name TEXT,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  UNIQUE(game_id, player_id)
);

CREATE INDEX idx_game_players_player_id ON game_players(player_id);
CREATE INDEX idx_game_players_game_id ON game_players(game_id);
