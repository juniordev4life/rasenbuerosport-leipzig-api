#!/usr/bin/env node

/**
 * Seed script — creates 4 test users and ~40 showcase games with
 * score timelines, match stats, and curated data for marketing screenshots.
 *
 * Run: node scripts/seed.js
 *
 * Uses signUp + signIn to comply with RLS policies.
 * Requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY in backend/.env
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Create a fresh client (no shared session state) */
function freshClient(key) {
	return createClient(SUPABASE_URL, key, {
		auth: { autoRefreshToken: false, persistSession: false },
	});
}

// ── Test users ──────────────────────────────────────────────────────
const TEST_USERS = [
	{ email: "max@test.de", username: "MaxMustermann", password: "Test1234!" },
	{ email: "lisa@test.de", username: "LisaKicker", password: "Test1234!" },
	{ email: "tom@test.de", username: "TomTorjäger", password: "Test1234!" },
	{ email: "anna@test.de", username: "AnnaAbwehr", password: "Test1234!" },
];

// ── Popular teams per league for variety ─────────────────────────────
const TEAMS = {
	bundesliga: [
		"RB Leipzig", "Bayern München", "Borussia Dortmund", "Bayer Leverkusen",
		"Eintracht Frankfurt", "VfB Stuttgart", "SC Freiburg", "SV Werder Bremen",
	],
	premier: [
		"Liverpool", "Arsenal", "Manchester City", "Chelsea",
		"Tottenham Hotspur", "Newcastle United",
	],
	laliga: ["Barcelona", "Real Madrid", "Atletico Madrid", "Sevilla"],
	seriea: ["Inter Milan", "AC Milan", "Juventus", "Napoli"],
};

const ALL_TEAMS = [
	...TEAMS.bundesliga, ...TEAMS.premier, ...TEAMS.laliga, ...TEAMS.seriea,
];

// ── Utility helpers ─────────────────────────────────────────────────

/** Pick a random element */
function pick(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

/** Random integer between min and max (inclusive) */
function randInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float between min and max */
function randFloat(min, max) {
	return +(min + Math.random() * (max - min)).toFixed(1);
}

/** Pick two different teams */
function pickTwoTeams() {
	const a = pick(ALL_TEAMS);
	let b = pick(ALL_TEAMS);
	while (b === a) b = pick(ALL_TEAMS);
	return [a, b];
}

/** Pick N unique items */
function pickUnique(arr, n) {
	const copy = [...arr];
	const result = [];
	for (let i = 0; i < n && copy.length > 0; i++) {
		const idx = Math.floor(Math.random() * copy.length);
		result.push(copy.splice(idx, 1)[0]);
	}
	return result;
}

/** Shuffle array in place */
function shuffle(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

/** Create a date string for a specific day in 2026 */
function dateAt(month, day, hour = 12) {
	const h = hour + randInt(0, 3);
	const m = randInt(0, 59);
	return new Date(2026, month - 1, day, h, m).toISOString();
}

// ── Score Timeline Generator ────────────────────────────────────────

/**
 * Generates a realistic score timeline
 * @param {number} scoreHome
 * @param {number} scoreAway
 * @param {string} resultType
 * @returns {object[]}
 */
function generateScoreTimeline(scoreHome, scoreAway, resultType) {
	const timeline = [];
	const totalGoals = scoreHome + scoreAway;
	if (totalGoals === 0) return [];

	let regHome = scoreHome;
	let regAway = scoreAway;
	let extraHome = 0;
	let extraAway = 0;
	let penHome = 0;
	let penAway = 0;

	if (resultType === "extra_time") {
		// Regulation ends tied, winning goals in extra time
		const tiedScore = Math.min(scoreHome, scoreAway);
		regHome = tiedScore;
		regAway = tiedScore;
		extraHome = scoreHome - tiedScore;
		extraAway = scoreAway - tiedScore;
	} else if (resultType === "penalty") {
		// Regulation + ET tied, penalties decide
		const tiedScore = Math.min(scoreHome, scoreAway);
		regHome = tiedScore;
		regAway = tiedScore;
		penHome = scoreHome - tiedScore;
		penAway = scoreAway - tiedScore;
	}

	// Build regular period goals
	const regGoals = [];
	for (let i = 0; i < regHome; i++) regGoals.push("home");
	for (let i = 0; i < regAway; i++) regGoals.push("away");
	shuffle(regGoals);

	let h = 0;
	let a = 0;
	for (const side of regGoals) {
		if (side === "home") h++;
		else a++;
		timeline.push({ home: h, away: a, period: "regular" });
	}

	// Extra time goals
	const etGoals = [];
	for (let i = 0; i < extraHome; i++) etGoals.push("home");
	for (let i = 0; i < extraAway; i++) etGoals.push("away");
	shuffle(etGoals);
	for (const side of etGoals) {
		if (side === "home") h++;
		else a++;
		timeline.push({ home: h, away: a, period: "extra_time" });
	}

	// Penalty goals (alternate)
	let pH = 0;
	let pA = 0;
	while (pH < penHome || pA < penAway) {
		if (pH < penHome) {
			h++;
			pH++;
			timeline.push({ home: h, away: a, period: "penalty" });
		}
		if (pA < penAway) {
			a++;
			pA++;
			timeline.push({ home: h, away: a, period: "penalty" });
		}
	}

	return timeline;
}

// ── Match Stats Generator ───────────────────────────────────────────

/**
 * Generates realistic FC26-style match stats
 * @param {number} scoreHome
 * @param {number} scoreAway
 * @param {object} [options]
 * @returns {object}
 */
function generateMatchStats(scoreHome, scoreAway, options = {}) {
	const {
		possessionHome,
		passAccuracyHome,
		passAccuracyAway,
		noYellowHome = false,
		noYellowAway = false,
		highDuelWinHome = false,
	} = options;

	// Possession (adds to 100)
	const possHome = possessionHome ?? randInt(38, 62);
	const possAway = 100 - possHome;

	// Shots (correlate with goals)
	const shotsHome = Math.max(scoreHome + randInt(1, 4), randInt(3, 7));
	const shotsAway = Math.max(scoreAway + randInt(1, 4), randInt(3, 7));

	// xG (correlate with goals but with variance)
	const xgHome = +Math.max(0.1, scoreHome * (0.65 + Math.random() * 0.5)).toFixed(1);
	const xgAway = +Math.max(0.1, scoreAway * (0.65 + Math.random() * 0.5)).toFixed(1);

	// Passes
	const passesHome = randInt(200, 420);
	const passesAway = randInt(200, 420);

	// Pass accuracy
	const paHome = passAccuracyHome ?? randInt(74, 92);
	const paAway = passAccuracyAway ?? randInt(74, 92);

	// Duels
	const duelsHome = randInt(35, 65);
	const duelsAway = randInt(35, 65);
	const dwMinHome = highDuelWinHome ? 0.58 : 0.35;
	const dwMaxHome = highDuelWinHome ? 0.75 : 0.65;
	const duelsWonHome = randInt(
		Math.floor(duelsHome * dwMinHome),
		Math.floor(duelsHome * dwMaxHome),
	);
	const duelsWonAway = randInt(
		Math.floor(duelsAway * 0.35),
		Math.floor(duelsAway * 0.65),
	);

	// Yellow cards
	const ycHome = noYellowHome ? 0 : randInt(0, 3);
	const ycAway = noYellowAway ? 0 : randInt(0, 3);

	return {
		possession: { home: possHome, away: possAway },
		shots: { home: shotsHome, away: shotsAway },
		xg: { home: xgHome, away: xgAway },
		passes: { home: passesHome, away: passesAway },
		pass_accuracy: { home: paHome, away: paAway },
		duels: { home: duelsHome, away: duelsAway },
		duels_won: { home: duelsWonHome, away: duelsWonAway },
		interceptions: { home: randInt(4, 14), away: randInt(4, 14) },
		saves: { home: randInt(0, 5), away: randInt(0, 5) },
		fouls: { home: randInt(2, 10), away: randInt(2, 10) },
		corners: { home: randInt(0, 7), away: randInt(0, 7) },
		yellow_cards: { home: ycHome, away: ycAway },
		dribbling: { home: randInt(58, 95), away: randInt(58, 95) },
		shot_accuracy: { home: randInt(35, 80), away: randInt(35, 80) },
	};
}

// ── Curated Game Definitions ────────────────────────────────────────

/**
 * Generates ~40 curated games for showcase screenshots.
 * MaxMustermann (userIds[0]) is the hero with ~65% winrate and all badge triggers.
 * @param {string[]} userIds - [Max, Lisa, Tom, Anna]
 */
function generateGames(userIds) {
	const [MAX, LISA, TOM, ANNA] = userIds;
	const games = [];

	// Helper: create a 1v1 game
	const g1v1 = (homeId, awayId, homeTeam, awayTeam, sh, sa, date, rt = "regular", ms = null) => ({
		mode: "1v1",
		score_home: sh,
		score_away: sa,
		played_at: date,
		created_by: homeId,
		result_type: rt,
		score_timeline: generateScoreTimeline(sh, sa, rt),
		match_stats: ms,
		players: [
			{ id: homeId, team: "home", team_name: homeTeam, rating: randInt(3, 5) },
			{ id: awayId, team: "away", team_name: awayTeam, rating: randInt(2, 5) },
		],
	});

	// Helper: create a 2v2 game
	const g2v2 = (h1, h2, a1, a2, homeTeam, awayTeam, sh, sa, date, rt = "regular", ms = null) => ({
		mode: "2v2",
		score_home: sh,
		score_away: sa,
		played_at: date,
		created_by: h1,
		result_type: rt,
		score_timeline: generateScoreTimeline(sh, sa, rt),
		match_stats: ms,
		players: [
			{ id: h1, team: "home", team_name: homeTeam, rating: randInt(3, 5) },
			{ id: h2, team: "home", team_name: homeTeam, rating: randInt(2, 5) },
			{ id: a1, team: "away", team_name: awayTeam, rating: randInt(2, 5) },
			{ id: a2, team: "away", team_name: awayTeam, rating: randInt(2, 5) },
		],
	});

	// ── Block A: Max's 5-game win streak (seriensieger badge) ────
	// Games 1-5: All Max wins, consecutive
	games.push(g1v1(MAX, LISA, "RB Leipzig", "Bayern München", 3, 1,
		dateAt(1, 6, 12),
		"regular",
		generateMatchStats(3, 1, { possessionHome: 58, passAccuracyHome: 89, noYellowHome: true, highDuelWinHome: true }),
	));
	games.push(g1v1(MAX, TOM, "RB Leipzig", "Borussia Dortmund", 2, 0,
		dateAt(1, 8, 13),
		"regular",
		generateMatchStats(2, 0, { possessionHome: 61, passAccuracyHome: 91, noYellowHome: true, highDuelWinHome: true }),
	)); // clean_sheet
	games.push(g1v1(MAX, ANNA, "Liverpool", "Arsenal", 4, 2,
		dateAt(1, 10, 14),
		"regular",
		generateMatchStats(4, 2, { possessionHome: 55, passAccuracyHome: 87, noYellowHome: true, highDuelWinHome: true }),
	));
	games.push(g1v1(MAX, LISA, "Barcelona", "Real Madrid", 1, 0,
		dateAt(1, 12, 12),
		"regular",
		generateMatchStats(1, 0, { possessionHome: 62, passAccuracyHome: 93, noYellowHome: true, highDuelWinHome: true }),
	)); // clean_sheet
	games.push(g1v1(MAX, TOM, "RB Leipzig", "Bayer Leverkusen", 3, 2,
		dateAt(1, 14, 15),
		"regular",
		generateMatchStats(3, 2, { possessionHome: 56, passAccuracyHome: 88, noYellowHome: true, highDuelWinHome: true }),
	));

	// ── Game 6: Max loss (breaks streak) ────────────────────────
	games.push(g1v1(MAX, LISA, "Chelsea", "Manchester City", 1, 3,
		dateAt(1, 16, 12),
		"regular",
		generateMatchStats(1, 3, { possessionHome: 42, passAccuracyHome: 78, noYellowHome: true }),
	));

	// ── Game 7: Max SCHÜTZENFEST — 6:1 win ──────────────────────
	games.push(g1v1(MAX, ANNA, "RB Leipzig", "SC Freiburg", 6, 1,
		dateAt(1, 18, 13),
		"regular",
		generateMatchStats(6, 1, { possessionHome: 65, passAccuracyHome: 90, noYellowHome: true, highDuelWinHome: true }),
	));

	// ── Game 8: Max PERFEKTIONIST — 100% pass accuracy ──────────
	games.push(g1v1(MAX, TOM, "Inter Milan", "AC Milan", 2, 1,
		dateAt(1, 20, 14),
		"regular",
		generateMatchStats(2, 1, { possessionHome: 59, passAccuracyHome: 100, noYellowHome: true, highDuelWinHome: true }),
	));

	// ── Game 9: Max win (no stats) ──────────────────────────────
	games.push(g1v1(MAX, ANNA, "Bayern München", "VfB Stuttgart", 3, 1,
		dateAt(1, 22, 12),
		"regular",
		null,
	));

	// ── Game 10: Max KONTER-KING — win with 35% possession ──────
	games.push(g1v1(MAX, LISA, "Atletico Madrid", "Barcelona", 2, 1,
		dateAt(1, 24, 15),
		"regular",
		generateMatchStats(2, 1, { possessionHome: 35, passAccuracyHome: 82, noYellowHome: true }),
	));

	// ── Game 11: Max DAVID VS GOLIATH — win with 25% possession ─
	games.push(g1v1(MAX, TOM, "Sevilla", "Real Madrid", 1, 0,
		dateAt(1, 26, 13),
		"regular",
		generateMatchStats(1, 0, { possessionHome: 25, passAccuracyHome: 80, noYellowHome: true }),
	));

	// ── Game 12: Max loss ───────────────────────────────────────
	games.push(g1v1(MAX, LISA, "Arsenal", "Liverpool", 0, 2,
		dateAt(1, 28, 12),
		"regular",
		generateMatchStats(0, 2, { possessionHome: 48, passAccuracyHome: 85, noYellowHome: true }),
	));

	// ── Game 13: Max extra time win ─────────────────────────────
	games.push(g1v1(MAX, ANNA, "RB Leipzig", "Eintracht Frankfurt", 3, 2,
		dateAt(1, 30, 14),
		"extra_time",
		generateMatchStats(3, 2, { possessionHome: 57, passAccuracyHome: 88, noYellowHome: true, highDuelWinHome: true }),
	));

	// ── Game 14-15: Max 2v2 wins ────────────────────────────────
	games.push(g2v2(MAX, ANNA, LISA, TOM, "RB Leipzig", "Bayern München", 4, 1,
		dateAt(2, 1, 12),
		"regular",
		generateMatchStats(4, 1, { possessionHome: 60, passAccuracyHome: 89, noYellowHome: true, highDuelWinHome: true }),
	));
	games.push(g2v2(MAX, TOM, LISA, ANNA, "Manchester City", "Chelsea", 3, 2,
		dateAt(2, 3, 13),
		"regular",
		generateMatchStats(3, 2, { possessionHome: 55, passAccuracyHome: 86, noYellowHome: true }),
	));

	// ── Game 16: Max penalty win ────────────────────────────────
	games.push(g1v1(MAX, LISA, "Juventus", "Napoli", 4, 3,
		dateAt(2, 5, 14),
		"penalty",
		generateMatchStats(4, 3, { possessionHome: 52, passAccuracyHome: 84, noYellowHome: true }),
	));

	// ── Game 17: Max draw ───────────────────────────────────────
	games.push(g1v1(MAX, TOM, "Borussia Dortmund", "Bayer Leverkusen", 2, 2,
		dateAt(2, 6, 12),
		"regular",
		null,
	));

	// ── Game 18-19: Max wins (no stats, for game count) ─────────
	games.push(g1v1(MAX, ANNA, "RB Leipzig", "SV Werder Bremen", 2, 0,
		dateAt(2, 7, 15),
		"regular",
		null,
	)); // clean_sheet
	games.push(g1v1(MAX, LISA, "Liverpool", "Tottenham Hotspur", 3, 1,
		dateAt(2, 8, 12),
		"regular",
		generateMatchStats(3, 1, { possessionHome: 58, passAccuracyHome: 90, noYellowHome: true, highDuelWinHome: true }),
	));

	// ── Game 20: Max loss ───────────────────────────────────────
	games.push(g1v1(MAX, TOM, "Chelsea", "Arsenal", 1, 4,
		dateAt(2, 9, 13),
		"regular",
		generateMatchStats(1, 4, { possessionHome: 40, passAccuracyHome: 76, noYellowHome: true }),
	));

	// ── Game 21-23: Max wins ────────────────────────────────────
	games.push(g1v1(MAX, ANNA, "Barcelona", "Atletico Madrid", 3, 0,
		dateAt(2, 10, 14),
		"regular",
		generateMatchStats(3, 0, { possessionHome: 63, passAccuracyHome: 91, noYellowHome: true, highDuelWinHome: true }),
	)); // clean_sheet
	games.push(g2v2(MAX, LISA, TOM, ANNA, "RB Leipzig", "Borussia Dortmund", 5, 2,
		dateAt(2, 12, 12),
		"regular",
		generateMatchStats(5, 2, { possessionHome: 58, passAccuracyHome: 87, noYellowHome: true, highDuelWinHome: true }),
	));
	games.push(g1v1(MAX, TOM, "Real Madrid", "Sevilla", 2, 1,
		dateAt(2, 13, 15),
		"regular",
		generateMatchStats(2, 1, { possessionHome: 56, passAccuracyHome: 89, noYellowHome: true, highDuelWinHome: true }),
	));

	// ── Game 24: Max loss ───────────────────────────────────────
	games.push(g1v1(MAX, LISA, "Eintracht Frankfurt", "RB Leipzig", 2, 3,
		dateAt(2, 14, 12),
		"regular",
		generateMatchStats(2, 3, { possessionHome: 45, passAccuracyHome: 82, noYellowHome: true }),
	));

	// ── Game 25-28: Max wins (reaching 28 total + recent hot streak) ─
	games.push(g1v1(MAX, ANNA, "RB Leipzig", "VfB Stuttgart", 4, 1,
		dateAt(2, 16, 13),
		"regular",
		generateMatchStats(4, 1, { possessionHome: 60, passAccuracyHome: 92, noYellowHome: true, highDuelWinHome: true }),
	));
	games.push(g2v2(MAX, TOM, ANNA, LISA, "Bayern München", "Borussia Dortmund", 3, 1,
		dateAt(2, 18, 14),
		"regular",
		generateMatchStats(3, 1, { possessionHome: 57, passAccuracyHome: 88, noYellowHome: true, highDuelWinHome: true }),
	));
	games.push(g1v1(MAX, LISA, "RB Leipzig", "Bayer Leverkusen", 3, 0,
		dateAt(2, 22, 12),
		"regular",
		generateMatchStats(3, 0, { possessionHome: 62, passAccuracyHome: 93, noYellowHome: true, highDuelWinHome: true }),
	)); // clean_sheet
	games.push(g1v1(MAX, TOM, "RB Leipzig", "Bayern München", 2, 1,
		dateAt(2, 25, 13),
		"regular",
		generateMatchStats(2, 1, { possessionHome: 54, passAccuracyHome: 90, noYellowHome: true, highDuelWinHome: true }),
	));

	// ── Block B: Games without Max (other players) ──────────────
	games.push(g1v1(LISA, TOM, "Barcelona", "Liverpool", 2, 3,
		dateAt(1, 7, 14),
		"regular",
		generateMatchStats(2, 3, {}),
	));
	games.push(g1v1(TOM, ANNA, "Bayern München", "RB Leipzig", 4, 0,
		dateAt(1, 11, 12),
		"regular",
		generateMatchStats(4, 0, {}),
	));
	games.push(g1v1(LISA, ANNA, "Chelsea", "Tottenham Hotspur", 1, 1,
		dateAt(1, 15, 15),
		"regular",
		null,
	));
	games.push(g1v1(ANNA, TOM, "Real Madrid", "Barcelona", 3, 2,
		dateAt(1, 19, 12),
		"extra_time",
		generateMatchStats(3, 2, {}),
	));
	games.push(g2v2(LISA, ANNA, TOM, MAX, "AC Milan", "Inter Milan", 2, 2,
		dateAt(1, 23, 14),
		"regular",
		null,
	)); // draw with Max on away
	games.push(g1v1(TOM, LISA, "Manchester City", "Arsenal", 0, 1,
		dateAt(1, 27, 13),
		"regular",
		generateMatchStats(0, 1, {}),
	));
	games.push(g1v1(ANNA, LISA, "Napoli", "Juventus", 2, 4,
		dateAt(2, 2, 12),
		"regular",
		generateMatchStats(2, 4, {}),
	));
	games.push(g2v2(TOM, ANNA, LISA, MAX, "Bayer Leverkusen", "RB Leipzig", 1, 3,
		dateAt(2, 4, 15),
		"regular",
		generateMatchStats(1, 3, {}),
	)); // Max on away team, wins
	games.push(g1v1(LISA, TOM, "VfB Stuttgart", "SC Freiburg", 3, 3,
		dateAt(2, 11, 12),
		"regular",
		generateMatchStats(3, 3, {}),
	));
	games.push(g1v1(TOM, ANNA, "SV Werder Bremen", "Eintracht Frankfurt", 2, 1,
		dateAt(2, 15, 14),
		"regular",
		null,
	));
	games.push(g2v2(LISA, TOM, ANNA, MAX, "Newcastle United", "Liverpool", 0, 2,
		dateAt(2, 20, 13),
		"regular",
		generateMatchStats(0, 2, { noYellowAway: true }),
	)); // Max on away, wins
	games.push(g1v1(ANNA, LISA, "Atletico Madrid", "Sevilla", 1, 0,
		dateAt(2, 24, 12),
		"regular",
		generateMatchStats(1, 0, {}),
	));

	// Sort all by date
	games.sort((a, b) => new Date(a.played_at) - new Date(b.played_at));

	return games;
}

// ── Main ────────────────────────────────────────────────────────────

async function seed() {
	console.log("🌱 Starting seed...\n");

	const adminClient = freshClient(SUPABASE_SERVICE_ROLE_KEY);

	// ── 1. Create / find users ──────────────────────────────────────
	/** @type {{ id: string, email: string, password: string }[]} */
	const users = [];

	for (const u of TEST_USERS) {
		const { data: existing } = await adminClient
			.from("profiles")
			.select("id, username")
			.eq("username", u.username)
			.maybeSingle();

		if (existing) {
			console.log(`  ✅ User "${u.username}" already exists (${existing.id})`);
			users.push({ id: existing.id, email: u.email, password: u.password });
			continue;
		}

		const anonClient = freshClient(SUPABASE_ANON_KEY);
		const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
			email: u.email,
			password: u.password,
			options: { data: { username: u.username } },
		});

		if (signUpError) {
			console.error(`  ❌ Failed to create "${u.username}":`, signUpError.message);
			continue;
		}

		const userId = signUpData.user?.id;
		if (!userId) {
			console.error(`  ❌ No user ID for "${u.username}"`);
			continue;
		}

		console.log(`  ✅ Created "${u.username}" (${userId})`);
		users.push({ id: userId, email: u.email, password: u.password });

		await new Promise((r) => setTimeout(r, 800));
	}

	if (users.length < 2) {
		console.error("\n❌ Need at least 2 users. Aborting.");
		process.exit(1);
	}

	const userIds = users.map((u) => u.id);
	console.log(`\n👥 ${users.length} users ready.\n`);

	// ── 2. Build authenticated clients for each user ────────────────
	/** @type {Map<string, import('@supabase/supabase-js').SupabaseClient>} */
	const authedClients = new Map();

	for (const u of users) {
		const client = freshClient(SUPABASE_ANON_KEY);
		const { error } = await client.auth.signInWithPassword({
			email: u.email,
			password: u.password,
		});
		if (error) {
			console.error(`  ❌ Login failed for ${u.email}:`, error.message);
			continue;
		}
		authedClients.set(u.id, client);
	}

	console.log(`🔑 ${authedClients.size} authenticated sessions.\n`);

	// ── 3. Generate and insert games ────────────────────────────────
	const gameDefs = generateGames(userIds);
	let created = 0;

	for (const g of gameDefs) {
		const client = authedClients.get(g.created_by);
		if (!client) {
			console.error(`  ❌ No session for creator ${g.created_by}`);
			continue;
		}

		// Insert game with all fields
		const { data: game, error: gameError } = await client
			.from("games")
			.insert({
				mode: g.mode,
				score_home: g.score_home,
				score_away: g.score_away,
				played_at: g.played_at,
				created_by: g.created_by,
				score_timeline: g.score_timeline?.length > 0 ? g.score_timeline : null,
				result_type: g.result_type || "regular",
				match_stats: g.match_stats || null,
			})
			.select()
			.single();

		if (gameError) {
			console.error(`  ❌ Game insert:`, gameError.message);
			continue;
		}

		// Insert game_players
		const gamePlayers = g.players.map((p) => ({
			game_id: game.id,
			player_id: p.id,
			team: p.team,
			team_name: p.team_name,
			rating: p.rating,
		}));

		const { error: playersError } = await client
			.from("game_players")
			.insert(gamePlayers);

		if (playersError) {
			console.error(`  ❌ Game players:`, playersError.message);
			continue;
		}

		created++;
		const rt = g.result_type !== "regular" ? ` (${g.result_type})` : "";
		const stats = g.match_stats ? " 📊" : "";
		const home = g.players.filter((p) => p.team === "home").map((p) => p.team_name).join(" & ");
		const away = g.players.filter((p) => p.team === "away").map((p) => p.team_name).join(" & ");
		console.log(
			`  ⚽ ${g.mode} | ${home} ${g.score_home}:${g.score_away} ${away}${rt}${stats} | ${new Date(g.played_at).toLocaleDateString("de-DE")}`,
		);
	}

	console.log(`\n🎉 Seed complete! Created ${created} games.\n`);
	console.log("📋 Test accounts:");
	for (const u of TEST_USERS) {
		console.log(`   ${u.username}: ${u.email} / ${u.password}`);
	}
}

seed().catch((err) => {
	console.error("Seed failed:", err);
	process.exit(1);
});
