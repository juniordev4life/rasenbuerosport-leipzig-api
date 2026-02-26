#!/usr/bin/env node

/**
 * Seed script — creates 4 test users and 25 games with realistic data.
 * Run: node scripts/seed.js
 *
 * Uses signUp + signIn to comply with RLS policies.
 * Requires SUPABASE_URL and SUPABASE_ANON_KEY in backend/.env
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

/** Pick a random element */
function pick(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

/** Random integer between min and max (inclusive) */
function randInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random date within the last N days */
function randomDate(daysBack) {
	return new Date(Date.now() - Math.random() * daysBack * 86400000).toISOString();
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

// ── Main ────────────────────────────────────────────────────────────

async function seed() {
	console.log("🌱 Starting seed...\n");

	const adminClient = freshClient(SUPABASE_SERVICE_ROLE_KEY);

	// ── 1. Create / find users ──────────────────────────────────────
	/** @type {{ id: string, email: string, password: string }[]} */
	const users = [];

	for (const u of TEST_USERS) {
		// Check if profile already exists
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

		// Sign up via anon client
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

		// Wait for trigger to create profile
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

		// Insert game
		const { data: game, error: gameError } = await client
			.from("games")
			.insert({
				mode: g.mode,
				score_home: g.score_home,
				score_away: g.score_away,
				played_at: g.played_at,
				created_by: g.created_by,
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
		const home = g.players.filter((p) => p.team === "home").map((p) => p.team_name).join(" & ");
		const away = g.players.filter((p) => p.team === "away").map((p) => p.team_name).join(" & ");
		console.log(
			`  ⚽ ${g.mode} | ${home} ${g.score_home}:${g.score_away} ${away} | ${new Date(g.played_at).toLocaleDateString("de-DE")}`,
		);
	}

	console.log(`\n🎉 Seed complete! Created ${created} games.\n`);
	console.log("📋 Test accounts:");
	for (const u of TEST_USERS) {
		console.log(`   ${u.username}: ${u.email} / ${u.password}`);
	}
}

/**
 * Generate 25 realistic game definitions
 * @param {string[]} userIds
 */
function generateGames(userIds) {
	const games = [];

	// ── 15 x 1v1 games ──────────────────────────────────────
	for (let i = 0; i < 15; i++) {
		const [p1, p2] = pickUnique(userIds, 2);
		const [homeTeam, awayTeam] = pickTwoTeams();

		games.push({
			mode: "1v1",
			score_home: randInt(0, 6),
			score_away: randInt(0, 6),
			played_at: randomDate(60),
			created_by: p1,
			players: [
				{ id: p1, team: "home", team_name: homeTeam, rating: randInt(2, 5) },
				{ id: p2, team: "away", team_name: awayTeam, rating: randInt(2, 5) },
			],
		});
	}

	// ── 10 x 2v2 games ──────────────────────────────────────
	for (let i = 0; i < 10; i++) {
		const four = pickUnique(userIds, Math.min(4, userIds.length));
		while (four.length < 4) four.push(pick(userIds));

		const [homeTeam, awayTeam] = pickTwoTeams();

		games.push({
			mode: "2v2",
			score_home: randInt(0, 7),
			score_away: randInt(0, 7),
			played_at: randomDate(45),
			created_by: four[0],
			players: [
				{ id: four[0], team: "home", team_name: homeTeam, rating: randInt(2, 5) },
				{ id: four[1], team: "home", team_name: homeTeam, rating: randInt(2, 5) },
				{ id: four[2], team: "away", team_name: awayTeam, rating: randInt(2, 5) },
				{ id: four[3], team: "away", team_name: awayTeam, rating: randInt(2, 5) },
			],
		});
	}

	// Sort oldest first
	games.sort((a, b) => new Date(a.played_at) - new Date(b.played_at));

	// Make last 3 games recent wins for user 0 → creates a hot streak 🔥
	const recent = games.slice(-3);
	for (const g of recent) {
		g.played_at = randomDate(3);
		g.created_by = userIds[0];
		if (g.mode === "1v1") {
			g.players[0].id = userIds[0];
			g.players[1].id = userIds[1];
			g.score_home = randInt(3, 6);
			g.score_away = randInt(0, 2);
		} else {
			g.players[0].id = userIds[0];
			g.players[1].id = userIds[2 % userIds.length];
			g.players[2].id = userIds[1];
			g.players[3].id = userIds[3 % userIds.length];
			g.score_home = randInt(3, 7);
			g.score_away = randInt(0, 2);
		}
	}

	games.sort((a, b) => new Date(a.played_at) - new Date(b.played_at));
	return games;
}

seed().catch((err) => {
	console.error("Seed failed:", err);
	process.exit(1);
});
