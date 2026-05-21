/**
 * Heuristic that classifies a finished game by how dramatic it was, so
 * the reporter prompt can dial its tone (low / medium / high). Used
 * exclusively by the match-report generator.
 *
 * Source signals: final score difference, red cards anywhere in the
 * `score_timeline`, late-stage goals (after minute 80) and comebacks
 * (a team trailed by ≥2 at some point but ended with a win or draw).
 */

/**
 * Detect a comeback inside a `score_timeline`. A comeback is defined as
 * a team trailing by `threshold` goals at some moment and the final
 * score being a win or draw for that team. Drama-level classification
 * uses `threshold=2` (any meaningful turnaround counts); the reporter
 * selection uses `threshold=3` so only genuine spectacle comebacks
 * trigger the hard rule that forces the Euphoriker persona.
 *
 * @param {Array<object>} timeline - Score timeline entries (goals + cards).
 * @param {number} finalHome - Final home score.
 * @param {number} finalAway - Final away score.
 * @param {number} [threshold=2] - Minimum deficit that must have occurred.
 * @returns {boolean}
 *
 * @example
 *   checkComeback(
 *     [{ event_type: "goal", home: 2, away: 0 }, { event_type: "goal", home: 2, away: 1 },
 *      { event_type: "goal", home: 2, away: 2 }, { event_type: "goal", home: 2, away: 3 }],
 *     2, 3,
 *   ); // → true (away trailed 0:2, won 3:2)
 */
export function checkComeback(timeline, finalHome, finalAway, threshold = 2) {
	if (!Array.isArray(timeline)) return false;
	let homeTrailedDeep = false;
	let awayTrailedDeep = false;
	for (const entry of timeline) {
		if (entry?.event_type !== "goal") continue;
		const home = typeof entry.home === "number" ? entry.home : null;
		const away = typeof entry.away === "number" ? entry.away : null;
		if (home == null || away == null) continue;
		if (away - home >= threshold) homeTrailedDeep = true;
		if (home - away >= threshold) awayTrailedDeep = true;
	}
	const homeRecovered = homeTrailedDeep && finalHome >= finalAway;
	const awayRecovered = awayTrailedDeep && finalAway >= finalHome;
	return homeRecovered || awayRecovered;
}

/**
 * Classify the drama level of a finished game.
 *
 * @param {object} game
 * @param {number} game.score_home
 * @param {number} game.score_away
 * @param {Array<object>} [game.score_timeline]
 * @returns {"low"|"medium"|"high"}
 *
 * @example
 *   determineDramaLevel({ score_home: 5, score_away: 0, score_timeline: [] });
 *   // → "low"
 */
export function determineDramaLevel(game) {
	const homeScore = Number(game?.score_home ?? 0);
	const awayScore = Number(game?.score_away ?? 0);
	const timeline = Array.isArray(game?.score_timeline)
		? game.score_timeline
		: [];

	const goalDiff = Math.abs(homeScore - awayScore);
	const hasRedCard = timeline.some(
		(e) =>
			e?.event_type === "red_card" ||
			(e?.event_type === "card" && e?.card_type === "red"),
	);
	const lateGoals = timeline.filter(
		(e) =>
			e?.event_type === "goal" &&
			typeof e?.minute === "number" &&
			e.minute > 80,
	).length;
	const comeback = checkComeback(timeline, homeScore, awayScore);

	if (goalDiff <= 1 || hasRedCard || lateGoals >= 2 || comeback) {
		return "high";
	}
	if (goalDiff >= 4 && !hasRedCard && lateGoals === 0) {
		return "low";
	}
	return "medium";
}
