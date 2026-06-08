#!/usr/bin/env bash
#
# Starts (or resumes) the local Postgres 16 used for development.
#
# Spins up a Docker Postgres 16 container on 127.0.0.1:5434 — the port the
# API's local DATABASE_URL points at. Safe to run repeatedly: if the container
# already exists it is (re)started, never recreated, so the data volume and any
# restored PROD snapshot are preserved.
#
# Usage:
#   npm run db:local        # or: bash scripts/db-local.sh
#
# Full reset (drops all local data):
#   docker rm -f rbsl-pg && docker volume rm rbsl-pg-data
set -euo pipefail

CONTAINER="rbsl-pg"
IMAGE="postgres:16"
VOLUME="rbsl-pg-data"
PORT="5434"
DB="rasenbuerosport"
PASSWORD="localdev"   # local-only throwaway password, bound to 127.0.0.1

# 1. Docker must be running
if ! docker info >/dev/null 2>&1; then
	echo "✗ Docker is not running. Start Docker Desktop and try again." >&2
	exit 1
fi

# 2. Create, resume, or report the container
if [ -n "$(docker ps -q -f "name=^${CONTAINER}$")" ]; then
	echo "✓ Container '${CONTAINER}' is already running."
elif [ -n "$(docker ps -aq -f "name=^${CONTAINER}$")" ]; then
	echo "▶ Resuming existing container '${CONTAINER}'..."
	docker start "${CONTAINER}" >/dev/null
else
	echo "▶ Creating container '${CONTAINER}' (Postgres 16 on port ${PORT})..."
	docker run -d \
		--name "${CONTAINER}" \
		-e POSTGRES_PASSWORD="${PASSWORD}" \
		-e POSTGRES_DB="${DB}" \
		-p "${PORT}:5432" \
		-v "${VOLUME}:/var/lib/postgresql/data" \
		"${IMAGE}" >/dev/null
fi

# 3. Wait until Postgres accepts connections
printf "Waiting for Postgres to accept connections"
for _ in $(seq 1 30); do
	if docker exec "${CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
		printf " — ready.\n\n"
		echo "Local DB is up. Put this in .env (and comment out the PROD DATABASE_URL):"
		echo "  DATABASE_URL=postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/${DB}"
		echo ""
		echo "Then start the API: npm run dev"
		exit 0
	fi
	printf "."
	sleep 1
done

printf "\n" >&2
echo "✗ Postgres did not become ready in time. Check: docker logs ${CONTAINER}" >&2
exit 1
