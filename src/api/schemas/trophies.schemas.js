/**
 * JSON-Schema definitions for the trophy room endpoint.
 *
 * Two-shape response: the full trophy list is uniform, but every entry
 * carries enough optional fields that the frontend can render the
 * three card states (earned / locked-with-progress / masked) without
 * branching on schema. Hidden + not-unlocked entries return only
 * `id`, `unlocked: false`, `masked: true`, `hidden: true` — name and
 * description are suppressed so the frontend renders "???".
 *
 * Progress is a `{ current, target, percent }` triple, only present
 * on threshold-driven trophies the player hasn't unlocked yet. For
 * one-shot shapes (e.g. cleanSheetWin) progress is null.
 */

export const playerIdParamsSchema = {
	type: "object",
	required: ["playerId"],
	properties: {
		playerId: { type: "string", minLength: 1 },
	},
};
