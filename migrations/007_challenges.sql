-- Migration 007: Weekly Challenges
-- Two tables drive the system:
--   * challenge_definitions — master catalog of available challenges
--   * challenge_weeks       — which definitions are active in which ISO week
--
-- Awards are computed live from games played within each week range — no
-- separate ledger table is required for v1. If push notifications on
-- completion are added later, an awards table can be layered on without
-- touching this schema.

CREATE TABLE IF NOT EXISTS challenge_definitions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	metric TEXT NOT NULL,
	target_value INTEGER NOT NULL CHECK (target_value > 0),
	reward_points INTEGER NOT NULL CHECK (reward_points > 0),
	difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
	label_de TEXT NOT NULL,
	label_en TEXT NOT NULL,
	description_de TEXT,
	description_en TEXT,
	emoji TEXT,
	active BOOLEAN NOT NULL DEFAULT TRUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenge_definitions_active
	ON challenge_definitions (active);

CREATE TABLE IF NOT EXISTS challenge_weeks (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	week_start DATE NOT NULL,
	week_end DATE NOT NULL,
	definition_id UUID NOT NULL
		REFERENCES challenge_definitions (id) ON DELETE RESTRICT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	UNIQUE (week_start, definition_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_weeks_week_start
	ON challenge_weeks (week_start DESC);

-- Seed the initial 8 definitions. The week_start UNIQUE on challenge_weeks lets
-- the API lazy-rotate via INSERT ... ON CONFLICT DO NOTHING when no rows exist
-- for the current week, so we ship without a Cloud Scheduler dependency.
INSERT INTO challenge_definitions
	(metric, target_value, reward_points, difficulty, label_de, label_en, description_de, description_en, emoji)
VALUES
	('goals_scored', 5, 10, 'easy',
		'5 Tore in dieser Woche',
		'Score 5 goals this week',
		'Schieße im Laufe der Woche fünf Tore in beliebigen Spielen.',
		'Score five goals across any games during the week.',
		'⚽'),
	('goals_scored', 15, 30, 'hard',
		'15 Tore in dieser Woche',
		'Score 15 goals this week',
		'Triff fünfzehn Mal — egal in welcher Form.',
		'Find the back of the net fifteen times — any way you can.',
		'🔥'),
	('clean_sheets', 2, 15, 'medium',
		'2 Spiele zu Null gewinnen',
		'Win 2 clean sheets',
		'Gewinne diese Woche zwei Spiele ohne Gegentor.',
		'Win two games without conceding this week.',
		'🛡️'),
	('wins', 3, 10, 'easy',
		'3 Siege in dieser Woche',
		'Win 3 games this week',
		'Drei Siege bringen dich vorne dabei.',
		'Three wins keep you in the running.',
		'🏆'),
	('games_played', 5, 5, 'easy',
		'5 Spiele bestreiten',
		'Play 5 games this week',
		'Sei aktiv: fünf Spiele in dieser Woche.',
		'Stay active: play five games this week.',
		'🎮'),
	('hattricks', 1, 20, 'medium',
		'Einen Hattrick erzielen',
		'Score a hat-trick',
		'Drei oder mehr Tore in einem einzigen Spiel.',
		'Three or more goals in a single game.',
		'🎩'),
	('comeback_wins', 1, 25, 'hard',
		'Comeback-Sieg (2+ Tore Rückstand)',
		'Comeback win (2+ goal deficit)',
		'Liege zwei Tore zurück und drehe das Spiel.',
		'Trail by at least two goals and turn the game around.',
		'🔄'),
	('duo_wins', 3, 15, 'medium',
		'3 Siege im 2v2',
		'3 wins in 2v2',
		'Holt euch zu zweit drei Siege im Doppel.',
		'Pair up and win three 2v2 games this week.',
		'🤝')
ON CONFLICT DO NOTHING;
