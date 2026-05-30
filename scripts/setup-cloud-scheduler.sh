#!/usr/bin/env bash
# One-shot Cloud Scheduler setup for the weekly cron jobs that drive
# `weekly_wrapped` and `talkshow_episodes`.
#
# Idempotent — re-running creates missing jobs and updates existing
# ones in place. Safe to run after a secret rotation, region change,
# or schedule change.
#
# See docs/cloud-scheduler-setup.md for the full runbook.

set -euo pipefail

# ---- Config ------------------------------------------------------------------

PROJECT_ID="${PROJECT_ID:-rasenbuerosport-leipzig-9d54f}"
REGION="${REGION:-europe-west3}"
SERVICE_NAME="${SERVICE_NAME:-rasenbuerosport-api}"
SECRET_NAME="${SECRET_NAME:-WRAPPED_TRIGGER_SECRET}"
TIME_ZONE="${TIME_ZONE:-Europe/Berlin}"

# Job definitions — name, cron, endpoint path, description, deadline.
# Talkshow fires one minute AFTER wrapped so it sees the same week's
# wrapped data already persisted. Audio render can take ~3-5 minutes
# (multi-speaker ElevenLabs + Firebase upload), hence the longer
# attempt deadline for that one.
JOBS=(
    "wrapped-weekly|0 22 * * 5|/api/v1/wrapped/generate|Weekly Wrapped generation — Fridays 22:00 Berlin.|180s"
    "talkshow-weekly|1 22 * * 5|/api/v1/talkshow/generate|Weekly Talkshow episode (script + multi-speaker mp3) — Fridays 22:01 Berlin.|540s"
)

# ---- Helpers ------------------------------------------------------------------

log() { printf "\033[1;34m▸\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*" >&2; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed or not in PATH"
}

# Create or update one Cloud Scheduler job idempotently.
#
# Args:
#   $1 = JOB_NAME      (e.g. wrapped-weekly)
#   $2 = SCHEDULE      (cron, e.g. "0 22 * * 5")
#   $3 = ENDPOINT_PATH (starts with /)
#   $4 = DESCRIPTION
#   $5 = ATTEMPT_DEADLINE (e.g. 180s, 540s)
ensure_job() {
    local job_name="$1"
    local schedule="$2"
    local endpoint_path="$3"
    local description="$4"
    local deadline="$5"

    local target_uri="${SERVICE_URL}${endpoint_path}"
    local action

    # `gcloud scheduler jobs create http` and `… update http` accept the
    # same set of flags EXCEPT for headers: create takes `--headers`,
    # update takes `--update-headers`. Passing `--headers` to update
    # errors out with "unrecognized arguments". Same quirk for
    # `--message-body` (kept as-is — both subcommands accept it).
    local headers_flag
    if gcloud scheduler jobs describe "$job_name" \
            --location="$REGION" \
            --project="$PROJECT_ID" >/dev/null 2>&1; then
        log "Job $job_name exists — updating in place"
        action="update"
        headers_flag="--update-headers"
    else
        log "Creating new job $job_name"
        action="create"
        headers_flag="--headers"
    fi

    gcloud scheduler jobs "$action" http "$job_name" \
        --location="$REGION" \
        --project="$PROJECT_ID" \
        --schedule="$schedule" \
        --time-zone="$TIME_ZONE" \
        --uri="$target_uri" \
        --http-method=POST \
        "$headers_flag=X-Trigger-Secret=${TRIGGER_SECRET},Content-Type=application/json" \
        --message-body='{}' \
        --description="$description Managed by scripts/setup-cloud-scheduler.sh." \
        --attempt-deadline="$deadline" \
        >/dev/null

    log "  $job_name → $target_uri ($schedule $TIME_ZONE)"
}

# ---- Preflight ---------------------------------------------------------------

require_cmd gcloud

log "Project   = $PROJECT_ID"
log "Region    = $REGION"
log "Service   = $SERVICE_NAME"
log "Time zone = $TIME_ZONE"

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

# ---- Create or update each job ----------------------------------------------

for spec in "${JOBS[@]}"; do
    IFS="|" read -r job_name schedule endpoint description deadline <<< "$spec"
    ensure_job "$job_name" "$schedule" "$endpoint" "$description" "$deadline"
done

log "Done. Inspect with:"
for spec in "${JOBS[@]}"; do
    IFS="|" read -r job_name _ _ _ _ <<< "$spec"
    echo "  gcloud scheduler jobs describe $job_name --location=$REGION --project=$PROJECT_ID"
done
echo
log "Smoke-test a job once with:"
echo "  gcloud scheduler jobs run wrapped-weekly --location=$REGION --project=$PROJECT_ID"
echo "  gcloud scheduler jobs run talkshow-weekly --location=$REGION --project=$PROJECT_ID"
