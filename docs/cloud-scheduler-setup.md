# Cloud Scheduler Setup — Weekly Wrapped + Talkshow

This doc covers the one-shot GCP setup for the Friday-evening cron jobs
that drive the Wrapped recap and the multi-speaker Talkshow episode.
**Production only** — local dev runs everything lazily on demand and
does not need scheduler jobs.

## Why

Two scheduler-protected endpoints kick off the Friday-evening pipeline:

| Endpoint | Job | Schedule (Europe/Berlin) | What it does |
|---|---|---|---|
| `POST /api/v1/wrapped/generate` | `wrapped-weekly` | Fr 22:00 | Computes the wrapped payload for the current week, writes to `weekly_wrapped` (idempotent on `week_start`). |
| `POST /api/v1/talkshow/generate` | `talkshow-weekly` | Fr 22:01 | Generates the 3-reporter talk-show drehbuch via Claude, renders the multi-speaker mp3 via ElevenLabs, persists both to `talkshow_episodes`. |

Both are protected by `requireSchedulerSecret` middleware — the static
shared secret in `WRAPPED_TRIGGER_SECRET` (one secret, both endpoints).

Without something calling those endpoints, `weekly_wrapped` /
`talkshow_episodes` stay empty and the matching frontend cards show the
empty state. Cloud Scheduler is the one-line cron that calls them. The
talkshow fires one minute after wrapped so the show context can read
the freshly-written wrapped row for the same week.

## Prerequisites

- `gcloud` CLI authenticated with an account that has at least
  `roles/cloudscheduler.admin` and `roles/secretmanager.secretAccessor`
  on project `rasenbuerosport-leipzig-9d54f`
- The Cloud Run service `rasenbuerosport-api` is deployed in
  `europe-west3` and reachable at its `*.run.app` URL
- Secret `WRAPPED_TRIGGER_SECRET` exists in Secret Manager (already the
  case — Match Day deploys reference it via `--set-secrets`)
- Cloud Scheduler API enabled on the project. Run once:

  ```bash
  gcloud services enable cloudscheduler.googleapis.com \
      --project=rasenbuerosport-leipzig-9d54f
  ```

## One-shot setup

```bash
./scripts/setup-cloud-scheduler.sh
```

The script:

1. Resolves the Cloud Run service URL via `gcloud run services
   describe`. No hardcoded URLs in source.
2. Reads the latest version of `WRAPPED_TRIGGER_SECRET` from Secret
   Manager.
3. Creates or updates **two** Cloud Scheduler jobs (both
   Europe/Berlin, both `--http-method=POST`, both with the
   `X-Trigger-Secret: <secret>` header):
   - `wrapped-weekly` — `0 22 * * 5` → `/api/v1/wrapped/generate`
     (180s deadline, fast pure-SQL aggregation)
   - `talkshow-weekly` — `1 22 * * 5` → `/api/v1/talkshow/generate`
     (540s deadline because the audio-render step does ~30 ElevenLabs
     TTS calls + concat + Firebase Storage upload)
4. Idempotent — re-running updates existing jobs in place and creates
   any that are missing.

Verify:

```bash
gcloud scheduler jobs describe wrapped-weekly \
    --location=europe-west3 \
    --project=rasenbuerosport-leipzig-9d54f

gcloud scheduler jobs describe talkshow-weekly \
    --location=europe-west3 \
    --project=rasenbuerosport-leipzig-9d54f
```

## Manual trigger (smoke test)

To trigger the job once without waiting for Friday 22:00:

```bash
gcloud scheduler jobs run wrapped-weekly \
    --location=europe-west3 \
    --project=rasenbuerosport-leipzig-9d54f
```

Then check the response in Cloud Run logs:

```bash
gcloud logging read \
    'resource.type="cloud_run_revision" AND
     resource.labels.service_name="rasenbuerosport-api" AND
     httpRequest.requestUrl=~"wrapped/generate"' \
    --project=rasenbuerosport-leipzig-9d54f \
    --limit=5 --format=json
```

A successful run logs `200 Created — Weekly wrapped generated` and the
`weekly_wrapped` table gets a fresh row for the current `week_start`.

## Rotating the trigger secret

If `WRAPPED_TRIGGER_SECRET` is rotated in Secret Manager, the scheduler
job still carries the old value as a static header. To pick up the new
version, just rerun the setup script — it always reads `latest` and
patches the job:

```bash
./scripts/setup-cloud-scheduler.sh
```

The Cloud Run service automatically picks up secret changes on its next
revision (controlled by the `--set-secrets` flag in Match Day).

## Why a static header instead of OIDC?

Two viable auth patterns for Scheduler → Cloud Run:

| Pattern | Pros | Cons |
|---|---|---|
| **`X-Trigger-Secret` header** (current) | Endpoint already validates this; no IAM dance; quick setup | Anyone with read access to the Scheduler job config can see the secret value |
| **OIDC + `roles/run.invoker`** | Identity is verified by Cloud Run before the request reaches the app; no secret in any job config | Needs a dedicated service account; the existing middleware would have to either be removed or layered on top |

For an office app where only admins with `roles/cloudscheduler.admin`
can see the job, the static-header approach is simpler and the secret
exposure surface is the same as Secret Manager itself. Switch to OIDC
later if/when the project grows.

## Future jobs (not currently scheduled)

These run lazily today — first user request of the period triggers
them. Move them to Scheduler when latency becomes a concern.

| Endpoint | Current trigger | Why lazy is OK |
|---|---|---|
| `challenges.rotate` (if added) | First `GET /v1/challenges/active` of the week | Inserting 3 rows is fast; first user pays maybe 50ms |
| `personal_recap_cache` cleanup | DB cascade keeps it self-pruning per-row | Cache is single-row-per-player; never grows beyond active roster |

If you want either of these on a real cron, copy the
`setup-cloud-scheduler.sh` block, replace endpoint + schedule, and add
to `scripts/setup-cloud-scheduler.sh`.

## Tearing down

If the project ever changes name or the Friday cadence stops:

```bash
gcloud scheduler jobs delete wrapped-weekly \
    --location=europe-west3 \
    --project=rasenbuerosport-leipzig-9d54f
```

`weekly_wrapped` rows are not affected.
