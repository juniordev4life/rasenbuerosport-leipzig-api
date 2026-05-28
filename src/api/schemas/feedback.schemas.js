/**
 * JSON-Schema definitions for the in-app feedback endpoint.
 *
 * Three kinds:
 *   - "general"  → routed to a mail recipient
 *   - "bug"      → filed as GitHub issue with the "bug" label
 *   - "feature"  → filed as GitHub issue with the "enhancement" label
 *
 * `title` is optional for "general" (we synthesise one if absent),
 * required for "bug"/"feature" because GitHub issues need one. We
 * enforce that branch in the service layer rather than in the JSON
 * schema, to keep the schema flat and the error message in the
 * user's language.
 */

export const feedbackBodySchema = {
	type: "object",
	required: ["kind", "description"],
	properties: {
		kind: { type: "string", enum: ["general", "bug", "feature"] },
		title: { type: "string", maxLength: 120 },
		description: { type: "string", minLength: 1, maxLength: 4000 },
		route: { type: "string", maxLength: 256 },
	},
	additionalProperties: false,
};
