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
