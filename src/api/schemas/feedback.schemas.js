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

/**
 * Screenshot upload — base64-encoded image (a `data:image/...;base64,...`
 * URL or the bare base64 payload). The frontend `FileReader` produces
 * a full data URL; we accept either form and trim the prefix in the
 * service. Max length covers a ~5 MB binary plus the data-url prefix
 * with comfortable headroom.
 *
 * Only honoured when `kind === "bug"` — feature requests and general
 * feedback don't take screenshots in V1.
 */
export const feedbackBodySchema = {
	type: "object",
	required: ["kind", "description"],
	properties: {
		kind: { type: "string", enum: ["general", "bug", "feature"] },
		title: { type: "string", maxLength: 120 },
		description: { type: "string", minLength: 1, maxLength: 4000 },
		route: { type: "string", maxLength: 256 },
		screenshot: { type: "string", maxLength: 8000000 },
	},
	additionalProperties: false,
};
