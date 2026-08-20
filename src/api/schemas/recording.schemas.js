/**
 * Schemas for the office recording agent flow.
 *
 * `game_id` on the command is deliberately a free-form string, not a UUID:
 * on "start" the app sends a client-generated provisional recording id
 * (the game row does not exist yet), and manual testing via curl may use
 * human-readable ids like "cardtest". Only the games PATCH params enforce
 * UUID, because there the id must address an actual `games` row.
 */

export const setRecordingCommandSchema = {
	body: {
		type: "object",
		required: ["action", "game_id"],
		properties: {
			action: { type: "string", enum: ["start", "stop", "abort"] },
			game_id: { type: "string", minLength: 1, maxLength: 100 },
		},
	},
};

/**
 * Result-only shootout, as the capture pipeline detects it: winner and final
 * score, no per-shot data (that only exists when a human tapped it in the app).
 * Shared by the finalize and the video-status endpoints so the agent can report
 * the same shape on either — see games.services.finalizeGame for why finalize
 * needs it at all (ELO runs there, and it must know the match was decided).
 */
export const autoPenaltyShootoutSchema = {
	type: "object",
	required: ["final_score", "winner_side"],
	additionalProperties: false,
	properties: {
		score_before: {
			type: "object",
			required: ["home", "away"],
			properties: {
				home: { type: "integer", minimum: 0 },
				away: { type: "integer", minimum: 0 },
			},
		},
		final_score: {
			type: "object",
			required: ["home", "away"],
			properties: {
				home: { type: "integer", minimum: 0 },
				away: { type: "integer", minimum: 0 },
			},
		},
		winner_side: { type: "string", enum: ["home", "away"] },
		source: { type: "string" },
	},
};

export const resultTypeSchema = {
	type: "string",
	enum: ["regular", "extra_time", "penalty"],
};

export const updateGameVideoSchema = {
	params: {
		type: "object",
		required: ["gameId"],
		properties: {
			gameId: { type: "string", format: "uuid" },
		},
	},
	body: {
		type: "object",
		required: ["video_status"],
		properties: {
			video_status: {
				type: "string",
				enum: ["recording", "uploaded", "processing", "ready", "failed"],
			},
			highlight_url: { type: "string", minLength: 1, maxLength: 2048 },
			// Optional: vom Highlight-Pipeline erkanntes Elfmeterschiessen.
			// result_type wechselt auf "penalty"; penalty_shootout ist hier die
			// ergebnis-only-Form ohne shots[] (automatisch erkannt -> source "auto").
			result_type: resultTypeSchema,
			penalty_shootout: autoPenaltyShootoutSchema,
		},
	},
};

export const reportRecordingStatusSchema = {
	body: {
		type: "object",
		required: ["recording_id", "status"],
		properties: {
			recording_id: { type: "string", minLength: 1, maxLength: 100 },
			status: {
				type: "string",
				enum: ["recording", "failed", "stopped", "aborted"],
			},
		},
	},
};

export const getRecordingStatusSchema = {
	querystring: {
		type: "object",
		required: ["recording_id"],
		properties: {
			recording_id: { type: "string", minLength: 1, maxLength: 100 },
		},
	},
};

export const getRecordingTimelineSchema = {
	querystring: {
		type: "object",
		required: ["game_id"],
		properties: {
			game_id: { type: "string", format: "uuid" },
		},
	},
};

export const finalizeGameSchema = {
	body: {
		type: "object",
		required: ["game_id", "score_timeline"],
		properties: {
			game_id: { type: "string", format: "uuid" },
			// Deep validation (chronology, running score) happens in
			// validateScoreTimeline inside the service — the entries come from
			// the vision pipeline in app format.
			score_timeline: {
				type: "array",
				minItems: 1,
				items: { type: "object" },
			},
			// A detected shootout has to arrive HERE, not only on the later
			// video-status PATCH: finalize is where ELO runs, and the engine
			// rates a shootout as a win instead of a draw. Reported after the
			// PATCH it would come too late and the match would stay a draw.
			result_type: resultTypeSchema,
			penalty_shootout: autoPenaltyShootoutSchema,
		},
	},
};

export const recordingStatsSchema = {
	body: {
		type: "object",
		required: ["game_id", "images"],
		properties: {
			game_id: { type: "string", format: "uuid" },
			images: {
				type: "object",
				minProperties: 1,
				properties: {
					overview: { type: "string", minLength: 1, maxLength: 2048 },
					passes: { type: "string", minLength: 1, maxLength: 2048 },
					defense: { type: "string", minLength: 1, maxLength: 2048 },
				},
				additionalProperties: false,
			},
		},
	},
};
