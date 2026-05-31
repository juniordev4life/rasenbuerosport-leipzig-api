/**
 * Schemas for the wrapped endpoints.
 *
 * Only request-side validation is enforced (the `limit` querystring on
 * the archive listing). The response is deliberately NOT pinned with a
 * JSON schema: Fastify's response-side schema is run through
 * `fast-json-stringify`, which silently strips any field not declared
 * in `properties`. The wrapped payload is a JSONB blob that grows
 * regularly (riser / loser / streak / trophies / talkrunde …) and the
 * `embedTalkrunde` helper adds a top-level field too — pinning the
 * shape there means every payload extension also needs a schema edit,
 * and missing the edit ships an invisible bug where new fields just
 * vanish on the wire. `setGeneralResponse()` already enforces the
 * outer envelope shape on every endpoint, so the trade-off here is
 * "leak any future field through" vs "drop new fields silently". The
 * former is the safer default for a payload that's still evolving.
 */

export const generateWrappedSchema = {};

export const getLatestWrappedSchema = {};

export const listWrappedSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
		},
	},
};
