# Cloud Scheduler Setup — Weekly Wrapped

This doc covers the one-shot GCP setup for the Friday-evening Wrapped
generation. **Production only** — local dev runs everything lazily on
demand and does not need scheduler jobs.

## Why

The API exposes `POST /api/v1/wrapped/generate` (protected by
`requireSchedulerSecret` middleware). The endpoint computes the wrapped
payload for the current Berlin week and writes it to `weekly_wrapped`,
overwriting any prior snapshot for the same `week_start`.

Without something calling that endpoint, `weekly_wrapped` stays empty
and `/app/wrapped` shows the empty state. Cloud Scheduler is the
one-line cron that calls it every Friday at 22:00 Berlin time.

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
3. Creates or updates the `wrapped-friday` Cloud Scheduler job with
   schedule `0 22 * * 5` Europe/Berlin, HTTP POST to
   `<service-url>/api/v1/wrapped/generate`, header
   `X-Trigger-Secret: <secret>`.
4. Idempotent — re-running updates the existing job in place.

Verify:

```bash
gcloud scheduler jobs describe wrapped-friday \
    --location=europe-west3 \
    --project=rasenbuerosport-leipzig-9d54f
```

## Manual trigger (smoke test)

To trigger the job once without waiting for Friday 22:00:

```bash
gcloud scheduler jobs run wrapped-friday \
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
gcloud scheduler jobs delete wrapped-friday \
    --location=europe-west3 \
    --project=rasenbuerosport-leipzig-9d54f
```

`weekly_wrapped` rows are not affected.
