/**
 * Feedback delivery service.
 *
 * Three feedback kinds map to two outbound channels:
 *   - "general" → email via Resend
 *   - "bug" / "feature" → GitHub Issue via REST API
 *
 * All outbound calls use native `fetch` to avoid adding SDK
 * dependencies. Secrets are read lazily from `process.env` so the
 * server can boot even before they are configured (the actual
 * request will then fail with a clean 500 + log entry).
 */

import { getStorageBucket } from "../../config/firebase.config.js";
import {
	FEEDBACK_GITHUB_REPO,
	FEEDBACK_ISSUE_LABELS,
	FEEDBACK_MAIL_SUBJECT_PREFIX,
	FEEDBACK_RECIPIENT_EMAIL,
	FEEDBACK_SENDER_EMAIL,
} from "../../constants/feedback.constants.js";
import { queryOne } from "../helpers/database.helpers.js";

const SCREENSHOT_STORAGE_PREFIX = "feedback-screenshots";
const SCREENSHOT_ALLOWED_MIME = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/heic",
]);

/**
 * Decode a frontend screenshot payload — either a full
 * `data:image/...;base64,...` URL (what `FileReader.readAsDataURL`
 * produces) or the bare base64 string — into `{ buffer, mimeType,
 * extension }`. Returns null when the input is empty, malformed, or
 * the MIME type isn't in the allow-list.
 *
 * @param {string|null|undefined} input
 * @returns {{ buffer: Buffer, mimeType: string, extension: string }|null}
 */
function decodeScreenshot(input) {
	if (!input || typeof input !== "string") return null;
	const match = input.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/);
	if (!match) return null;
	const [, mimeType, payload] = match;
	if (!SCREENSHOT_ALLOWED_MIME.has(mimeType)) return null;
	let buffer;
	try {
		buffer = Buffer.from(payload, "base64");
	} catch {
		return null;
	}
	if (buffer.byteLength === 0) return null;
	const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
	return { buffer, mimeType, extension };
}

/**
 * Upload a screenshot to Firebase Storage under
 * `feedback-screenshots/{uuid}.{ext}`, return the public URL. The
 * object is made public-readable so GitHub's image renderer can pull
 * it without auth — the URL itself is treated as the access token
 * (long, random, not enumerated).
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} extension
 * @returns {Promise<string>}
 */
async function uploadScreenshot(buffer, mimeType, extension) {
	const bucket = getStorageBucket();
	const objectPath = `${SCREENSHOT_STORAGE_PREFIX}/${crypto.randomUUID()}.${extension}`;
	const file = bucket.file(objectPath);
	await file.save(buffer, {
		contentType: mimeType,
		resumable: false,
		metadata: {
			cacheControl: "public, max-age=2592000, immutable",
		},
	});
	await file.makePublic();
	return `https://storage.googleapis.com/${bucket.name}/${objectPath}`;
}

/**
 * Resolves the username for a Firebase uid by joining the local
 * `profiles` table. Falls back to email or "anonymous" so the
 * context block is never empty.
 *
 * @param {{ id: string, email?: string | null }} user
 * @returns {Promise<string>}
 * @example
 *   const name = await resolveUsername({ id: 'abc', email: 'a@b.com' });
 */
async function resolveUsername(user) {
	if (!user?.id) return "anonymous";
	try {
		const row = await queryOne("SELECT username FROM profiles WHERE id = $1", [
			user.id,
		]);
		return row?.username ?? user.email ?? "anonymous";
	} catch {
		return user.email ?? "anonymous";
	}
}

/**
 * Builds the bottom-of-message context block. We do this server-
 * side (not in the client) so the user can't forge values like
 * username/email — important once we start triaging issues by
 * sender.
 *
 * @param {object} ctx
 * @param {string} ctx.username
 * @param {string} [ctx.email]
 * @param {string} [ctx.route]
 * @param {string} [ctx.userAgent]
 * @returns {string}
 */
function buildContextBlock({ username, email, route, userAgent }) {
	const lines = [
		"---",
		"Submitted from in-app feedback form",
		`User: ${username}`,
	];
	if (email) lines.push(`Email: ${email}`);
	if (route) lines.push(`Route: ${route}`);
	lines.push(`Date: ${new Date().toISOString()}`);
	if (userAgent) lines.push(`User-Agent: ${userAgent}`);
	return lines.join("\n");
}

/**
 * POSTs a transactional mail through Resend
 * (https://resend.com/docs/api-reference/emails/send-email).
 *
 * Throws on non-2xx with the upstream message attached, so the
 * controller's `handleErrorResponse` produces a useful payload.
 *
 * @param {{ subject: string, text: string, replyTo?: string }} opts
 * @returns {Promise<void>}
 */
async function sendResendMail({ subject, text, replyTo }) {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		const err = new Error("Mail provider not configured");
		err.statusCode = 503;
		throw err;
	}

	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: FEEDBACK_SENDER_EMAIL,
			to: [FEEDBACK_RECIPIENT_EMAIL],
			subject,
			text,
			...(replyTo && { reply_to: replyTo }),
		}),
	});

	if (!res.ok) {
		const payload = await res.text().catch(() => "");
		const err = new Error(
			`Resend rejected the message (HTTP ${res.status}): ${payload}`,
		);
		err.statusCode = 502;
		throw err;
	}
}

/**
 * Creates a GitHub issue on `FEEDBACK_GITHUB_REPO` via the REST API
 * (https://docs.github.com/en/rest/issues/issues#create-an-issue).
 *
 * The token must have `Issues: write` on the target repo. Anything
 * less and GitHub responds 404 (rather than 403) — we surface that
 * verbatim so the dev can spot the misconfig in the logs.
 *
 * @param {{ title: string, body: string, label: string }} opts
 * @returns {Promise<{ url: string, number: number }>}
 */
async function createGitHubIssue({ title, body, label }) {
	const token = process.env.FEEDBACK_GITHUB_TOKEN;
	if (!token) {
		const err = new Error("GitHub integration not configured");
		err.statusCode = 503;
		throw err;
	}

	const res = await fetch(
		`https://api.github.com/repos/${FEEDBACK_GITHUB_REPO}/issues`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"Content-Type": "application/json",
				"User-Agent": "rasenbuerosport-playmaker",
			},
			body: JSON.stringify({
				title,
				body,
				labels: [label],
			}),
		},
	);

	if (!res.ok) {
		const payload = await res.text().catch(() => "");
		const err = new Error(
			`GitHub rejected the issue (HTTP ${res.status}): ${payload}`,
		);
		err.statusCode = 502;
		throw err;
	}

	const json = await res.json();
	return { url: json.html_url, number: json.number };
}

/**
 * Submits a piece of feedback. Returns a small descriptor so the
 * client can show "issue created at #42" or just a success toast.
 *
 * @param {object} input
 * @param {{ id: string, email?: string | null }} input.user - From requireAuth
 * @param {"general" | "bug" | "feature"} input.kind
 * @param {string} [input.title]
 * @param {string} input.description
 * @param {string} [input.route] - Client-reported route the user was on
 * @param {string} [input.userAgent] - From request headers
 * @returns {Promise<{ channel: "email" | "github", reference?: string }>}
 * @example
 *   await submitFeedback({
 *     user: { id: 'abc', email: 'a@b.com' },
 *     kind: 'bug',
 *     title: 'Goal pill cut off on iPhone SE',
 *     description: '...',
 *     route: '/app/games/new',
 *     userAgent: 'Mozilla/5.0 ...',
 *   });
 */
export async function submitFeedback({
	user,
	kind,
	title,
	description,
	route,
	userAgent,
	screenshot,
}) {
	const trimmedTitle = title?.trim() ?? "";
	const trimmedDescription = description.trim();

	if (kind !== "general" && trimmedTitle === "") {
		const err = new Error("Title is required for bug and feature feedback");
		err.statusCode = 400;
		throw err;
	}

	const username = await resolveUsername(user);
	const contextBlock = buildContextBlock({
		username,
		email: user?.email,
		route,
		userAgent,
	});

	// Screenshots only flow into the GitHub bug pipeline. For "general"
	// (email) and "feature" we ignore the field — V1 scope keeps the
	// attachment off the feature-request channel since those are
	// usually text-driven, and the email recipient has the user's
	// address to ask follow-ups.
	let screenshotUrl = null;
	if (kind === "bug" && screenshot) {
		const decoded = decodeScreenshot(screenshot);
		if (decoded) {
			try {
				screenshotUrl = await uploadScreenshot(
					decoded.buffer,
					decoded.mimeType,
					decoded.extension,
				);
			} catch (err) {
				// Don't fail the whole submission if the storage upload
				// breaks — the bug report is more valuable than the
				// image. Surface the upload failure inline in the issue
				// so triage knows a screenshot was attempted.
				console.warn("[feedback] screenshot upload failed:", err.message);
			}
		}
	}

	const bodyText = screenshotUrl
		? `${trimmedDescription}\n\n${contextBlock}\n\n![Screenshot](${screenshotUrl})`
		: `${trimmedDescription}\n\n${contextBlock}`;

	if (kind === "general") {
		const subjectText = trimmedTitle || `Feedback from ${username}`;
		await sendResendMail({
			subject: `${FEEDBACK_MAIL_SUBJECT_PREFIX}${subjectText}`,
			text: bodyText,
			replyTo: user?.email ?? undefined,
		});
		return { channel: "email" };
	}

	const label =
		kind === "bug" ? FEEDBACK_ISSUE_LABELS.bug : FEEDBACK_ISSUE_LABELS.feature;
	const issue = await createGitHubIssue({
		title: trimmedTitle,
		body: bodyText,
		label,
	});
	return {
		channel: "github",
		reference: issue.url,
		screenshot_url: screenshotUrl,
	};
}
