-- Migration 003: Elo Rating System
-- Tracks current player ratings and full Elo history per game

-- Current player Elo ratings (one row per player)
CREATE TABLE player_ratings (
  player_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  elo INTEGER NOT NULL DEFAULT 1200,
  peak_elo INTEGER NOT NULL DEFAULT 1200,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Elo change history per game (one row per player per game)
CREATE TABLE elo_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  elo_before INTEGER NOT NULL,
  elo_after INTEGER NOT NULL,
  elo_change INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game_id, player_id)
);

CREATE INDEX idx_elo_history_player_id ON elo_history(player_id);
CREATE INDEX idx_elo_history_game_id ON elo_history(game_id);
CREATE INDEX idx_elo_history_created_at ON elo_history(created_at DESC);
CREATE INDEX idx_player_ratings_elo ON player_ratings(elo DESC);
