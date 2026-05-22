-- Migration 016: Web-Push subscriptions.
--
-- Stores one row per browser/device that has opted in to push
-- notifications. A single user can have multiple subscriptions
-- (desktop + mobile + PWA). The `endpoint` is the URL the browser
-- push service hands out; together with the two encryption keys it
-- forms the credentials the `web-push` library needs on the server
-- side to deliver a payload.
--
-- `last_used_at` is bumped on every successful send and drives the
-- inactivity cleanup; `failure_count` counts consecutive non-410/404
-- failures so a flaky subscription gets dropped at five strikes.

CREATE TABLE IF NOT EXISTS push_subscriptions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	endpoint TEXT NOT NULL,
	p256dh TEXT NOT NULL,
	auth TEXT NOT NULL,
	user_agent TEXT,
	preferences JSONB NOT NULL DEFAULT '{"newMatch":true}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_used_at TIMESTAMPTZ,
	failure_count INTEGER NOT NULL DEFAULT 0,
	UNIQUE (endpoint)
);

-- "Get all subscriptions of a user" — settings page + delete flows.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
	ON push_subscriptions (user_id);

-- "Drop ones inactive for 90+ days" — cleanup cron.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_last_used_at
	ON push_subscriptions (last_used_at);
