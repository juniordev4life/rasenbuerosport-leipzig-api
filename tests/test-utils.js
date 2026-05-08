/**
 * Shared test utilities for the Playmaker API.
 *
 * Builders for the most common entities (`games`, `game_players`, score-timeline
 * entries) so that individual tests stay short and follow the AAA pattern.
 */

/**
 * Build a mock `games` row with sensible defaults.
 *
 * @param {Partial<{
 *   id: string,
 *   mode: "1v1"|"2v2",
 *   score_home: number,
 *   score_away: number,
 *   played_at: string,
 *   created_by: string,
 *   score_timeline: Array<object>,
 *   result_type: "regular"|"extra_time"|"penalty",
 *   match_stats: object|null,
 * }>} [overrides]
 * @returns {object}
 *
 * @example
 *   const game = buildMockGame({ score_home: 3, score_away: 1 });
 */
export function buildMockGame(overrides = {}) {
	return {
		id: "game-1",
		mode: "1v1",
		score_home: 0,
		score_away: 0,
		played_at: "2026-05-01T18:00:00.000Z",
		created_by: "user-1",
		created_at: "2026-05-01T18:00:00.000Z",
		score_timeline: [],
		result_type: "regular",
		match_stats: null,
		match_report: null,
		stats_image_url: null,
		passes_image_url: null,
		defense_image_url: null,
		...overrides,
	};
}

/**
 * Build a mock `game_players` row.
 *
 * @param {Partial<{
 *   id: string,
 *   game_id: string,
 *   player_id: string,
 *   team: "home"|"away",
 *   team_name: string,
 *   rating: number,
 * }>} [overrides]
 * @returns {object}
 *
 * @example
 *   const gp = buildMockGamePlayer({ player_id: "user-2", team: "away" });
 */
export function buildMockGamePlayer(overrides = {}) {
	return {
		id: "gp-1",
		game_id: "game-1",
		player_id: "user-1",
		team: "home",
		team_name: "Bayern",
		rating: 4,
		...overrides,
	};
}

/**
 * Build a goal entry for `score_timeline`. Defaults to a play-style goal
 * by `user-1` for the home team in minute 25.
 *
 * @param {Partial<{
 *   home: number, away: number,
 *   period: "regular"|"extra_time"|"penalty",
 *   scored_by: string, assist_by: string,
 *   goal_type: "play"|"corner"|"freekick"|"penalty",
 *   minute: number, stoppage: number,
 *   event_type: "goal",
 * }>} [overrides]
 * @returns {object}
 *
 * @example
 *   const goal = buildGoalEvent({ minute: 11, scored_by: "user-2" });
 */
export function buildGoalEvent(overrides = {}) {
	return {
		home: 1,
		away: 0,
		period: "regular",
		scored_by: "user-1",
		goal_type: "play",
		minute: 25,
		stoppage: 0,
		...overrides,
	};
}

/**
 * Build a red-card entry for `score_timeline`.
 *
 * @param {Partial<{
 *   event_type: "red_card",
 *   player_id: string, team: "home"|"away",
 *   period: "regular"|"extra_time",
 *   minute: number, stoppage: number,
 * }>} [overrides]
 * @returns {object}
 *
 * @example
 *   const red = buildRedCardEvent({ player_id: "user-2", minute: 67 });
 */
export function buildRedCardEvent(overrides = {}) {
	return {
		event_type: "red_card",
		player_id: "user-1",
		team: "home",
		period: "regular",
		minute: 60,
		stoppage: 0,
		...overrides,
	};
}

/**
 * Build a unified card entry for `score_timeline`. Defaults to a yellow
 * card by `user-1` for the home team in minute 60.
 *
 * @param {Partial<{
 *   event_type: "card",
 *   card_type: "yellow"|"red",
 *   player_id: string, team: "home"|"away",
 *   period: "regular"|"extra_time",
 *   minute: number, stoppage: number,
 * }>} [overrides]
 * @returns {object}
 *
 * @example
 *   const yellow = buildCardEvent({ player_id: "user-2", minute: 30 });
 *   const red = buildCardEvent({ card_type: "red" });
 */
export function buildCardEvent(overrides = {}) {
	return {
		event_type: "card",
		card_type: "yellow",
		player_id: "user-1",
		team: "home",
		period: "regular",
		minute: 60,
		stoppage: 0,
		...overrides,
	};
}

/**
 * Build a missed-penalty entry for `score_timeline`.
 *
 * @param {Partial<{
 *   event_type: "penalty_missed",
 *   shooter_id: string, keeper_id: string|null,
 *   team: "home"|"away",
 *   period: "regular"|"extra_time",
 *   minute: number, stoppage: number,
 * }>} [overrides]
 * @returns {object}
 *
 * @example
 *   const miss = buildPenaltyMissedEvent({ shooter_id: "user-1", keeper_id: "user-2" });
 */
export function buildPenaltyMissedEvent(overrides = {}) {
	return {
		event_type: "penalty_missed",
		shooter_id: "user-1",
		keeper_id: "user-2",
		team: "home",
		period: "regular",
		minute: 30,
		stoppage: 0,
		...overrides,
	};
}

/**
 * Build a Fastify-reply mock that captures the status code and the payload
 * sent via `reply.status(code).send(body)`. Useful for unit-testing controllers
 * and helpers without spinning up the full Fastify server.
 *
 * @returns {{
 *   reply: { status: (code: number) => any, send: (payload: any) => any, sent: boolean },
 *   getStatus: () => number|undefined,
 *   getPayload: () => any,
 * }}
 *
 * @example
 *   const { reply, getStatus, getPayload } = buildMockReply();
 *   await controller.handler(req, reply);
 *   expect(getStatus()).toBe(200);
 *   expect(getPayload().data).toEqual({ ... });
 */
export function buildMockReply() {
	let status;
	let payload;
	const reply = {
		sent: false,
		status(code) {
			status = code;
			return reply;
		},
		send(body) {
			payload = body;
			reply.sent = true;
			return reply;
		},
	};
	return {
		reply,
		getStatus: () => status,
		getPayload: () => payload,
	};
}
