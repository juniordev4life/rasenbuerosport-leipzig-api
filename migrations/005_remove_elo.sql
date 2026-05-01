-- Migration 005: Remove Elo Rating System
-- Drops everything created in 003_elo_system.sql

DROP INDEX IF EXISTS idx_player_ratings_elo;
DROP INDEX IF EXISTS idx_elo_history_created_at;
DROP INDEX IF EXISTS idx_elo_history_game_id;
DROP INDEX IF EXISTS idx_elo_history_player_id;

DROP TABLE IF EXISTS elo_history;
DROP TABLE IF EXISTS player_ratings;
