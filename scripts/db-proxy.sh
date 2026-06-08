#!/usr/bin/env bash
#
# Opens a connection to the PRODUCTION database via the Cloud SQL Auth Proxy.
#
# Starts cloud-sql-proxy in the foreground on 127.0.0.1:5433. The proxy
# authenticates to Cloud SQL with your gcloud Application Default Credentials
# (IAM) — it does NOT use a database password. Ctrl+C stops it.
#
# Once it is running, connect from another terminal using your PROD
# credentials from .env (never hard-code them):
#   set -a; source .env; set +a
#   psql "$DATABASE_URL"                                   # if DATABASE_URL points at :5433
#   pg_dump "$DATABASE_URL" --no-owner --no-acl \
#     --file="$HOME/rbsl-prod-dump.sql"                    # read-only snapshot
#
# Usage:
#   npm run db:proxy        # or: bash scripts/db-proxy.sh
set -euo pipefail

INSTANCE="${CLOUD_SQL_INSTANCE:-rasenbuerosport-leipzig-9d54f:europe-west3:rasenbuerosport-db}"
PORT="${CLOUD_SQL_PROXY_PORT:-5433}"

# 1. Proxy binary must be installed
if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
	echo "✗ 'cloud-sql-proxy' not found on PATH." >&2
	echo "  Install: https://cloud.google.com/sql/docs/postgres/sql-proxy#install" >&2
	exit 1
fi

# 2. Show who/what we authenticate as (best-effort, never fatal)
if command -v gcloud >/dev/null 2>&1; then
	account="$(gcloud config get-value account 2>/dev/null || true)"
	project="$(gcloud config get-value project 2>/dev/null || true)"
	echo "gcloud account: ${account:-<none>}"
	echo "gcloud project: ${project:-<none>}"
	echo "If ADC is missing, run: gcloud auth application-default login"
	echo ""
fi

echo "▶ Starting Cloud SQL Auth Proxy → ${INSTANCE}"
echo "  Listening on 127.0.0.1:${PORT} (foreground; press Ctrl+C to stop)"
echo ""

# exec replaces this shell so Ctrl+C / signals reach the proxy directly
exec cloud-sql-proxy "${INSTANCE}" --port="${PORT}"
