/**
 * Offline simulation of the proposed League-ELO v2 over every finalized
 * game — read-only, nothing is written to the database. Prints the ranking
 * the new system would show today next to the current ratings, plus the
 * parallel duo table.
 *
 *   DATABASE_URL=postgresql://postgres:localdev@127.0.0.1:5434/<db> \
 *     node scripts/simulate-elo-v2.js [--json=out.json] [--today=2026-09-25]
 *
 * Meant for a LOCAL snapshot of production (README → "Local Development
 * with a PROD Snapshot"). Players inactive for more than 8 weeks are hidden
 * from the ranking, as the rulebook proposes; they still carry a rating.
 */

import { writeFile } from "node:fs/promises";
import "dotenv/config";
import {
	assignPairingGameNumbers,
	buildMatchV2,
} from "../src/api/services/elo/leagueEloV2Input.services.js";
import { replayLeagueEloV2 } from "../src/api/services/elo/leagueEloV2Replay.services.js";
import { closePool, getPool } from "../src/config/database.config.js";

const HIDE_AFTER_DAYS = 56;
const args = Object.fromEntries(
	process.argv
		.slice(2)
		.filter((a) => a.startsWith("--"))
		.map((a) => a.slice(2).split("=")),
);

function describeTarget() {
	try {
		const url = new URL(process.env.DATABASE_URL);
		return `${url.hostname}:${url.port || 5432}${url.pathname}`;
	} catch {
		return "<DATABASE_URL missing or unparseable>";
	}
}

async function loadData(pool) {
	const games = await pool.query(
		"SELECT * FROM games WHERE pending = false ORDER BY played_at ASC, id ASC",
	);
	const lineups = await pool.query(
		"SELECT game_id, player_id, team FROM game_players",
	);
	const profiles = await pool.query(
		"SELECT id, username, current_rating, matches_played FROM profiles",
	);
	const byGame = new Map();
	for (const row of lineups.rows) {
		const list = byGame.get(row.game_id) ?? [];
		list.push(row);
		byGame.set(row.game_id, list);
	}
	return { games: games.rows, byGame, profiles: profiles.rows };
}

function buildRanking(players, profiles, today) {
	const current = [...profiles].sort(
		(a, b) => b.current_rating - a.current_rating,
	);
	const currentRank = new Map(current.map((p, i) => [p.id, i + 1]));
	const rows = profiles
		.filter((p) => players.has(p.id))
		.map((p) => {
			const sim = players.get(p.id);
			const idleDays = (today - new Date(sim.lastPlayedAt)) / 86400000;
			return {
				name: p.username,
				rating: sim.rating,
				games: sim.games,
				record: `${sim.wins}-${sim.draws}-${sim.losses}`,
				currentRating: p.current_rating,
				currentRank: currentRank.get(p.id),
				lastPlayed: new Date(sim.lastPlayedAt).toISOString().slice(0, 10),
				hidden: idleDays > HIDE_AFTER_DAYS,
			};
		})
		.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, "de"));
	let rank = 0;
	for (const row of rows) row.rank = row.hidden ? null : ++rank;
	return rows;
}

function buildDuoTable(duos, names) {
	return [...duos.values()]
		.map((d) => ({
			name: d.playerIds
				.map((id) => names.get(id) ?? id.slice(0, 6))
				.join(" & "),
			rating: d.rating,
			games: d.games,
			record: `${d.wins}-${d.draws}-${d.losses}`,
			goals: `${d.goalsFor}:${d.goalsAgainst}`,
		}))
		.sort((a, b) => b.rating - a.rating);
}

function printTable(title, rows, columns) {
	console.log(`\n${title}`);
	const widths = columns.map(([label, key]) =>
		Math.max(label.length, ...rows.map((r) => String(r[key] ?? "–").length)),
	);
	const line = (cells) =>
		cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
	console.log(line(columns.map(([label]) => label)));
	console.log(line(widths.map((w) => "-".repeat(w))));
	for (const r of rows)
		console.log(line(columns.map(([, key]) => r[key] ?? "–")));
}

function summarize(log, skipped, handicap) {
	const count = (fn) => log.filter(fn).length;
	return {
		rated: log.length,
		skipped,
		modes: {
			"1v1": count((e) => e.result.mode === "1v1"),
			"2v2": count((e) => e.result.mode === "2v2"),
			"1v2": count((e) => e.result.mode === "1v2"),
		},
		shootouts: count((e) => e.result.shootout),
		repeatedPairings: count((e) => (e.match.pairingGameNumber ?? 1) > 1),
		handicapFinal: handicap,
	};
}

const pool = getPool();
console.log(`target database:   ${describeTarget()}  (read-only)`);
try {
	const { games, byGame, profiles } = await loadData(pool);
	const names = new Map(profiles.map((p) => [p.id, p.username]));
	const skipped = [];
	const built = [];
	for (const game of games) {
		const match = buildMatchV2(game, byGame.get(game.id) ?? []);
		if (match) built.push(match);
		else
			skipped.push({
				gameId: game.id,
				playedAt: game.played_at,
				reason: "a side has no players",
			});
	}
	const { players, duos, handicap, log } = replayLeagueEloV2(
		assignPairingGameNumbers(built),
	);
	const today = args.today ? new Date(args.today) : new Date();
	const ranking = buildRanking(players, profiles, today);
	const duoTable = buildDuoTable(duos, names);
	const summary = summarize(log, skipped, handicap);

	console.log("\n=== League-ELO v2 simulation ===");
	console.log(JSON.stringify(summary, null, 2));
	printTable("Ranking (new) vs. current ELO", ranking, [
		["#", "rank"],
		["Player", "name"],
		["ELO v2", "rating"],
		["Games", "games"],
		["W-D-L", "record"],
		["Current ELO", "currentRating"],
		["Current #", "currentRank"],
		["Last game", "lastPlayed"],
		["Hidden", "hidden"],
	]);
	printTable("Duo table", duoTable, [
		["Duo", "name"],
		["Duo ELO", "rating"],
		["Games", "games"],
		["W-D-L", "record"],
		["Goals", "goals"],
	]);
	if (args.json) {
		await writeFile(
			args.json,
			JSON.stringify({ summary, ranking, duoTable }, null, 2),
		);
		console.log(`\nwritten: ${args.json}`);
	}
} finally {
	await closePool();
}
