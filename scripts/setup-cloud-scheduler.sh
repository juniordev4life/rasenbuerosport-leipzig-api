#!/usr/bin/env bash
# One-shot Cloud Scheduler setup for the weekly Wrapped generation.
#
# Idempotent — re-running updates the existing job in place. Safe to
# run after a secret rotation, region change, or schedule change.
#
# See docs/cloud-scheduler-setup.md for the full runbook.

set -euo pipefail

# ---- Config ------------------------------------------------------------------

PROJECT_ID="${PROJECT_ID:-rasenbuerosport-leipzig-9d54f}"
REGION="${REGION:-europe-west3}"
SERVICE_NAME="${SERVICE_NAME:-rasenbuerosport-api}"
SECRET_NAME="${SECRET_NAME:-WRAPPED_TRIGGER_SECRET}"
JOB_NAME="${JOB_NAME:-wrapped-friday}"
SCHEDULE="${SCHEDULE:-0 22 * * 5}"        # Friday 22:00
TIME_ZONE="${TIME_ZONE:-Europe/Berlin}"
ENDPOINT_PATH="/api/v1/wrapped/generate"

# ---- Helpers ------------------------------------------------------------------

log() { printf "\033[1;34m▸\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*" >&2; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed or not in PATH"
}

# ---- Preflight ---------------------------------------------------------------

require_cmd gcloud

log "Project   = $PROJECT_ID"
log "Region    = $REGION"
log "Service   = $SERVICE_NAME"
log "Job       = $JOB_NAME"
log "Schedule  = $SCHEDULE ($TIME_ZONE)"

# Confirm the Cloud Scheduler API is enabled
if ! gcloud services list --enabled --project="$PROJECT_ID" \
        --filter="config.name=cloudscheduler.googleapis.com" \
        --format="value(config.name)" | grep -q .; then
    fail "Cloud Scheduler API is not enabled on $PROJECT_ID. Run:\n  gcloud services enable cloudscheduler.googleapis.com --project=$PROJECT_ID"
fi

# Resolve the Cloud Run service URL
log "Resolving Cloud Run service URL…"
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format="value(status.url)" 2>/dev/null || true)

if [[ -z "$SERVICE_URL" ]]; then
    fail "Could not resolve Cloud Run service URL for $SERVICE_NAME in $REGION. Is the service deployed?"
fi
log "  → $SERVICE_URL"

TARGET_URI="${SERVICE_URL}${ENDPOINT_PATH}"

# Read the trigger secret
log "Reading $SECRET_NAME (latest) from Secret Manager…"
TRIGGER_SECRET=$(gcloud secrets versions access latest \
    --secret="$SECRET_NAME" \
    --project="$PROJECT_ID" 2>/dev/null || true)

if [[ -z "$TRIGGER_SECRET" ]]; then
    fail "Could not read secret $SECRET_NAME. Does it exist? Do you have roles/secretmanager.secretAccessor?"
fi

# Sanity: avoid uploading anything that looks fishy
if [[ "${#TRIGGER_SECRET}" -lt 16 ]]; then
    warn "Secret value is shorter than 16 chars — proceeding, but you may want a stronger token."
fi

# ---- Create or update the job -----------------------------------------------

if gcloud scheduler jobs describe "$JOB_NAME" \
        --location="$REGION" \
        --project="$PROJECT_ID" >/dev/null 2>&1; then
    log "Job $JOB_NAME exists — updating in place"
    ACTION="update"
else
    log "Creating new job $JOB_NAME"
    ACTION="create"
fi

gcloud scheduler jobs "$ACTION" http "$JOB_NAME" \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --schedule="$SCHEDULE" \
    --time-zone="$TIME_ZONE" \
    --uri="$TARGET_URI" \
    --http-method=POST \
    --headers="X-Trigger-Secret=${TRIGGER_SECRET},Content-Type=application/json" \
    --message-body='{}' \
    --description="Weekly Wrapped generation — Fridays 22:00 Berlin. Managed by scripts/setup-cloud-scheduler.sh." \
    --attempt-deadline=180s \
    >/dev/null

log "Done. Inspect with:"
echo "  gcloud scheduler jobs describe $JOB_NAME --location=$REGION --project=$PROJECT_ID"
echo
log "Smoke-test the job once with:"
echo "  gcloud scheduler jobs run $JOB_NAME --location=$REGION --project=$PROJECT_ID"
