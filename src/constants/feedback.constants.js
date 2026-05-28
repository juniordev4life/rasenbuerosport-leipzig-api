/**
 * Destinations and labels for the in-app Feedback endpoint.
 *
 * Keeping these in a constants file means we can swap recipient,
 * repo or labels without touching service code. The actual secrets
 * (Resend API key, GitHub PAT) live in environment variables and
 * are read inside the service.
 */

/**
 * GitHub repository the bug/feature issues are filed against.
 * Format: "owner/repo".
 *
 * Overridable via `FEEDBACK_GITHUB_REPO` env var so we can point at
 * a sandbox repo in dev without touching code.
 */
export const FEEDBACK_GITHUB_REPO =
	process.env.FEEDBACK_GITHUB_REPO ??
	"juniordev4life/rasenbuerosport-leipzig-app";

/**
 * Recipient address for "general" feedback. Defaults to the project
 * owner; overridable via `FEEDBACK_RECIPIENT_EMAIL`.
 */
export const FEEDBACK_RECIPIENT_EMAIL =
	process.env.FEEDBACK_RECIPIENT_EMAIL ?? "marco.slusalek@redbulls.com";

/**
 * Sender address used by Resend. Must be a domain verified inside
 * the Resend dashboard. For local dev / unverified setups, Resend
 * accepts `onboarding@resend.dev` as a sandbox sender.
 */
export const FEEDBACK_SENDER_EMAIL =
	process.env.FEEDBACK_SENDER_EMAIL ?? "feedback@onboarding.resend.dev";

/**
 * Labels applied when creating GitHub issues. They line up with the
 * default labels GitHub auto-creates; unknown labels are silently
 * dropped on submit, so absence is non-fatal.
 */
export const FEEDBACK_ISSUE_LABELS = Object.freeze({
	bug: "bug",
	feature: "enhancement",
});

/**
 * Subject-line prefix on outgoing mails so the inbox filter / rules
 * can pick the messages out of regular traffic.
 */
export const FEEDBACK_MAIL_SUBJECT_PREFIX = "[RBSL App] ";
