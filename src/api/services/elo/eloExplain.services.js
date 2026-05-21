/**
 * Human-readable explanation tags for an ELO change.
 *
 * The match-detail UI shows the player's ELO delta and, right below
 * it, a small list of tags that explain why the delta is what it
 * is. Examples: "Torschütze", "2 Vorlagen", "Rote Karte (84')",
 * "Sieg", "Carry-Performance".
 *
 * These tags are derived from the player's match stats plus the
 * PlayerEloResult so the rules stay consistent across UI surfaces.
 */

/**
 * @typedef {import("./eloEngine.services.js").PlayerEloResult} PlayerEloResult
 * @typedef {import("./contributionScore.services.js").PlayerMatchStats} PlayerMatchStats
 */

/**
 * Build the explanation-tag list for a single player's ELO change
 * in a single match.
 *
 * @param {PlayerEloResult} result - Output of computeMatchElo for this player.
 * @param {PlayerMatchStats} stats - Same stats fed into the engine.
 * @param {boolean} isWinner - True if the player's team won.
 * @returns {string[]}
 *
 * @example
 *   explainEloChange(
 *     result,
 *     { goals: 1, assists: 0, redCards: [] },
 *     true,
 *   );
 *   // → ["Torschütze", "Sieg"]
 *
 * @example
 *   explainEloChange(
 *     result,
 *     { goals: 0, assists: 0, redCards: [{ minute: 84 }] },
 *     false,
 *   );
 *   // → ["Rote Karte (84')", "Niederlage", "Mitläufer-Schutz"]
 */
export function explainEloChange(result, stats, isWinner) {
	const tags = [];

	const goals = Number(stats?.goals ?? 0);
	const assists = Number(stats?.assists ?? 0);
	const redCards = Array.isArray(stats?.redCards) ? stats.redCards : [];

	if (goals > 0) tags.push(goals === 1 ? "Torschütze" : `${goals} Tore`);
	if (assists > 0)
		tags.push(assists === 1 ? "Vorlagengeber" : `${assists} Vorlagen`);

	for (const card of redCards) {
		const minute = Number(card?.minute);
		if (Number.isFinite(minute)) tags.push(`Rote Karte (${minute}')`);
	}

	tags.push(isWinner ? "Sieg" : "Niederlage");

	const share = Number(result?.share);
	if (Number.isFinite(share)) {
		if (share <= 0.25) {
			tags.push(isWinner ? "Mitläufer-Bonus" : "Mitläufer-Schutz");
		} else if (share >= 0.7) {
			tags.push(isWinner ? "Carry-Performance" : "Trotz Top-Beitrag");
		}
	}

	return tags;
}
