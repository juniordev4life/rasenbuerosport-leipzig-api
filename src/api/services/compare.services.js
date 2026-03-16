import { queryOne } from "../helpers/database.helpers.js";
import { getHeadToHead } from "./h2h.services.js";
import { getUserStats } from "./stats.services.js";

/**
 * Gets comparison data for two players: full stats for each + head-to-head
 * @param {string} player1Id
 * @param {string} player2Id
 * @param {string} [from] - ISO date start boundary
 * @param {string} [to] - ISO date end boundary
 * @returns {Promise<object>}
 */
export async function getPlayerComparison(player1Id, player2Id, from, to) {
	const [player1Stats, player2Stats, h2h, p1Profile, p2Profile] =
		await Promise.all([
			getUserStats(player1Id, from, to),
			getUserStats(player2Id, from, to),
			getHeadToHead(player1Id, player2Id),
			queryOne("SELECT username, avatar_url FROM profiles WHERE id = $1", [
				player1Id,
			]),
			queryOne("SELECT username, avatar_url FROM profiles WHERE id = $1", [
				player2Id,
			]),
		]);

	return {
		player1: {
			player_id: player1Id,
			username: p1Profile?.username || "Unknown",
			avatar_url: p1Profile?.avatar_url || null,
			stats: player1Stats,
		},
		player2: {
			player_id: player2Id,
			username: p2Profile?.username || "Unknown",
			avatar_url: p2Profile?.avatar_url || null,
			stats: player2Stats,
		},
		h2h,
	};
}
