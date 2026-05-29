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
 * Sender address used by Resend.
 *
 * For production, set this to an address on a domain you have
 * verified in the Resend dashboard (DNS records — SPF, DKIM, DMARC
 * — pointing at Resend). Until that's done, the only sender Resend
 * will accept is its sandbox address `onboarding@resend.dev`.
 *
 * Sandbox restriction: while using `onboarding@resend.dev`, Resend
 * only permits sending TO the email registered on the account.
 * Verify-your-domain unlocks arbitrary recipients.
 *
 * Earlier shipped default `feedback@onboarding.resend.dev` looked
 * like a valid sandbox sender but is actually an unverified
 * subdomain — Resend rejects it with HTTP 403
 * ("The onboarding.resend.dev domain is not verified").
 */
export const FEEDBACK_SENDER_EMAIL =
	process.env.FEEDBACK_SENDER_EMAIL ?? "onboarding@resend.dev";

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
