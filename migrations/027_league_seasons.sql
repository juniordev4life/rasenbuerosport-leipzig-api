-- Migration 027: League seasons (EA FC editions) + League-ELO v2 state
--
-- A league season is an EA FC edition (FC26, FC27, …), not a calendar
-- quarter — the quarter "seasons" in src/utils/season.utils.js stay as they
-- are for the stats page. ELO runs continuously across league seasons; a
-- season is a logical cut used for standings, the league table and the
-- season recap. Membership is the half-open range [starts_at, ends_at) on
-- games.played_at; exactly one season is open (ends_at IS NULL).
--
-- FC26 → FC27 cut: the last FC26 game was played on Tue 22.09.2026 12:52
-- Europe/Berlin, the first FC27 game at 17:37 the same day.
--
-- Additive only. Apply BEFORE deploying the API release that reads it.

CREATE TABLE IF NOT EXISTS league_seasons (
	id                 TEXT PRIMARY KEY,
	name               TEXT NOT NULL,
	game_version       TEXT NOT NULL,
	starts_at          TIMESTAMPTZ NOT NULL,
	ends_at            TIMESTAMPTZ,
	awards             JSONB,
	talkrunde          JSONB,
	recap_generated_at TIMESTAMPTZ,
	recap_notified_at  TIMESTAMPTZ,
	created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
	CHECK (ends_at IS NULL OR ends_at > starts_at)
);

-- At most one open season.
CREATE UNIQUE INDEX IF NOT EXISTS idx_league_seasons_single_open
	ON league_seasons ((ends_at IS NULL)) WHERE ends_at IS NULL;

INSERT INTO league_seasons (id, name, game_version, starts_at, ends_at)
VALUES
	('fc26', 'EA FC 26', 'FC26', '2026-03-13 00:00 Europe/Berlin', '2026-09-22 15:00 Europe/Berlin'),
	('fc27', 'EA FC 27', 'FC27', '2026-09-22 15:00 Europe/Berlin', NULL)
ON CONFLICT (id) DO NOTHING;

-- Per-season League-ELO v2 standings, rewritten by every recompute: player
-- and duo ratings at season start and end (or "now" for the open season)
-- plus the learned 1v2 handicap. One JSONB row per season.
CREATE TABLE IF NOT EXISTS season_elo_standings (
	season_id   TEXT PRIMARY KEY REFERENCES league_seasons(id) ON DELETE CASCADE,
	payload     JSONB NOT NULL,
	computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generated per-player season recap ("Rückblick"), see seasonRecap.services.js.
CREATE TABLE IF NOT EXISTS season_recaps (
	season_id    TEXT NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
	player_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	payload      JSONB NOT NULL,
	generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (season_id, player_id)
);

-- Small key/value store for switches the API reads at runtime. Key 'elo'
-- holds {engine, activated_at, input_hash, plan_hash, backup}; League-ELO v2
-- only writes ratings once scripts/recompute-league-elo.js --apply set
-- engine = 'v2' (after taking its backup).
CREATE TABLE IF NOT EXISTS app_state (
	key        TEXT PRIMARY KEY,
	value      JSONB NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
