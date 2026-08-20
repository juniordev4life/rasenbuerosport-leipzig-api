#!/usr/bin/env bash
#
# Runs a command against the PRODUCTION database, through the Cloud SQL Auth
# Proxy. Exists because `.env` holds the LOCAL dev DATABASE_URL (Docker Postgres
# on :5434, see CLAUDE.md) — so any script that reads it silently targets local,
# even while the proxy is up. That footgun already sent two `elo:recompute` runs
# to the wrong database.
#
# The credentials come from Secret Manager and are never printed; only the
# target host/port/database is echoed so the operator can see what is about to
# be touched.
#
# Prerequisites:
#   1. npm run db:proxy                       # in another terminal, keep it open
#   2. gcloud auth application-default login  # as the prod owner account
#
# Usage:
#   bash scripts/with-prod-db.sh npm run elo:recompute -- --dry-run
#   bash scripts/with-prod-db.sh npm run elo:recompute -- --apply --backup
set -euo pipefail

PORT="${CLOUD_SQL_PROXY_PORT:-5433}"
PROJECT="${GCP_PROJECT:-rasenbuerosport-leipzig-9d54f}"
ACCOUNT="${GCP_ACCOUNT:-marco.slusalek@googlemail.com}"

if [ "$#" -eq 0 ]; then
	echo "✗ Nothing to run. Example:" >&2
	echo "  bash scripts/with-prod-db.sh npm run elo:recompute -- --dry-run" >&2
	exit 1
fi

# 1. The proxy has to be up, otherwise the command fails halfway through with a
#    bare ECONNREFUSED and no hint about what was missing.
if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
	echo "✗ No Cloud SQL proxy on 127.0.0.1:${PORT}." >&2
	echo "  Start it in another terminal:  npm run db:proxy" >&2
	exit 1
fi

# 2. Fetch the prod URL and rewrite its Cloud Run unix-socket host to the proxy.
if ! secret="$(gcloud secrets versions access latest --secret=DATABASE_URL \
	--project="$PROJECT" --account="$ACCOUNT" 2>/dev/null)"; then
	echo "✗ Could not read the DATABASE_URL secret as ${ACCOUNT}." >&2
	echo "  The redbulls account has no access to ${PROJECT}." >&2
	exit 1
fi

DATABASE_URL="$(SECRET="$secret" PORT="$PORT" python3 <<'PY'
import os
import re
import urllib.parse as up

raw = re.sub(r"[?&]host=[^&]*", "", os.environ["SECRET"].strip())
parsed = up.urlparse(raw)
db = (parsed.path or "/rasenbuerosport").lstrip("/") or "rasenbuerosport"
user = up.quote(up.unquote(parsed.username or "postgres"), safe="")
pw = up.quote(up.unquote(parsed.password or ""), safe="")
print(f"postgresql://{user}:{pw}@127.0.0.1:{os.environ['PORT']}/{db}")
PY
)"

# 3. Say what will be touched — credentials stay out of the output.
target="$(DATABASE_URL="$DATABASE_URL" python3 -c '
import os, urllib.parse as up
p = up.urlparse(os.environ["DATABASE_URL"])
print(f"{p.hostname}:{p.port}{p.path} as {p.username}")
')"
echo "▶ PRODUCTION database → ${target}"
echo "  running: $*"
echo ""

export DATABASE_URL
exec "$@"
