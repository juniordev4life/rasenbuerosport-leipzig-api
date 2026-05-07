# Infrastructure Notes — RasenBürosport Leipzig

This file is the **single textual inventory** of the live GCP/Firebase infrastructure for RasenBürosport Leipzig. It is the pragmatic stand-in for a Terraform "Coach" repo: when we eventually do migrate to Terraform, this list is the import plan.

**Scope:** both the API (`rasenbuerosport-leipzig-api`, deployed to Cloud Run) and the App (`rasenbuerosport-leipzig-app`, deployed to Firebase Hosting) plus all shared resources.

> **Maintenance rule:** anything you change in the GCP / Firebase console — IAM binding, scheduler cron, secret value, new env var on Cloud Run — gets a one-line update here in the same PR. If it isn't in this file, treat it as undocumented and verify before touching.

---

## Project & Region

| Field | Value |
|-------|-------|
| GCP Project ID | `rasenbuerosport-leipzig-9d54f` |
| GCP Project Number | _TODO: fill in from `gcloud projects describe rasenbuerosport-leipzig-9d54f`_ |
| Primary Region | `europe-west3` (Frankfurt) |
| Firebase Project | same as GCP project (single project) |
| Firebase App ID prefix | `1:651313...` (web app) |

---

## Cloud SQL (Postgres)

| Field | Value |
|-------|-------|
| Instance name | `rasenbuerosport-db` |
| Connection name | `rasenbuerosport-leipzig-9d54f:europe-west3:rasenbuerosport-db` |
| Postgres version | `POSTGRES_16` |
| Tier | `db-f1-micro` |
| Region / zone | `europe-west3-a` |
| Public IP | `34.179.149.164` (subject to change — prefer the connection name) |
| Database name | `rasenbuerosport` |
| Primary user | `postgres` (password in 1Password / team vault) |
| PITR enabled | _TODO: verify — recommended `true` for prod_ |
| Delete protection | _TODO: verify — recommended `true` for prod_ |
| Backups | _TODO: verify schedule + retention_ |
| Authorized networks | _TODO: list, or confirm "none, proxy only"_ |
| Maintenance window | _TODO: list day + hour_ |

**Connectivity matrix**

| Caller | How |
|--------|-----|
| Cloud Run (API) | Cloud SQL connector, Unix socket `/cloudsql/<connection-name>` |
| Local dev (snapshot) | Cloud SQL Auth Proxy on `127.0.0.1:5433` for one-off `pg_dump`, then Docker Postgres on `5434` |
| Local dev (read PROD) | Same proxy on `5433`, point `DATABASE_URL` at it (avoid for daily work) |

---

## Cloud Run (API)

| Field | Value |
|-------|-------|
| Service name | _TODO: confirm — likely `rasenbuerosport-api` or similar_ |
| Region | `europe-west3` |
| Container image | Built from repo `Dockerfile`, pushed to Artifact Registry (_TODO: confirm registry path_) |
| Port | `8080` (Cloud Run default) |
| Min / Max instances | _TODO: fill in_ |
| Memory / CPU | _TODO: fill in_ |
| Service Account | _TODO: fill in (e.g. `api-runtime@…iam.gserviceaccount.com`)_ |
| Cloud SQL connection | Attached: `rasenbuerosport-leipzig-9d54f:europe-west3:rasenbuerosport-db` |
| Ingress | _TODO: `all` or `internal-and-cloud-load-balancing`?_ |
| Custom domain | _TODO: `api.<domain>` mapping if any_ |
| Trigger | _TODO: Cloud Build trigger on push to `main`?_ |

**Required env vars (set on the Cloud Run service):**

| Variable | Source | Notes |
|----------|--------|-------|
| `PORT` | Cloud Run injects | `8080` |
| `NODE_ENV` | static | `production` |
| `DATABASE_URL` | Secret Manager (`rbsl-database-url`) | Uses Cloud SQL Unix socket |
| `FIREBASE_PROJECT_ID` | static | `rasenbuerosport-leipzig-9d54f` |
| `CORS_ORIGIN` | static | Firebase Hosting URL(s), comma-separated |
| `ANTHROPIC_API_KEY` | Secret Manager (`rbsl-anthropic-api-key`) | |
| `WRAPPED_TRIGGER_SECRET` | Secret Manager (`rbsl-wrapped-trigger-secret`) | Shared with Cloud Scheduler job |

> Secret names above are **proposed** — replace with the actual names once verified in Secret Manager.

---

## Firebase Hosting (App)

| Field | Value |
|-------|-------|
| Hosting Site ID | _TODO: confirm — defaults to project ID_ |
| Custom domain | _TODO: e.g. `rasenbuerosport.de` if mapped_ |
| Deploy command | `npm run deploy` from `rasenbuerosport-leipzig-app` (`firebase deploy --only hosting`) |
| SPA rewrite | `** → /index.html` (see `firebase.json`) |
| Cache headers | 1y immutable on hashed assets (see `firebase.json`) |
| CDN | Firebase Hosting CDN (built-in, global) |

**Build env vars (set in CI / `.env.production` for the app):**

| Variable | Value |
|----------|-------|
| `PUBLIC_API_URL` | Cloud Run service URL (e.g. `https://api.<domain>` or the run.app URL) |
| `PUBLIC_FIREBASE_API_KEY` | from Firebase Console → Project Settings → Web app |
| `PUBLIC_FIREBASE_AUTH_DOMAIN` | `rasenbuerosport-leipzig-9d54f.firebaseapp.com` |
| `PUBLIC_FIREBASE_PROJECT_ID` | `rasenbuerosport-leipzig-9d54f` |
| `PUBLIC_FIREBASE_STORAGE_BUCKET` | `rasenbuerosport-leipzig-9d54f.firebasestorage.app` |
| `PUBLIC_FIREBASE_APP_ID` | `1:651313...` |
| `PUBLIC_TOLGEE_API_KEY` | optional, only for translation editing |
| `PUBLIC_TOLGEE_API_URL` | `https://app.tolgee.io` |

---

## Firebase Authentication

| Field | Value |
|-------|-------|
| Sign-in providers | Google (popup) — _TODO: confirm if any others enabled_ |
| Authorized domains | `localhost`, `<project>.firebaseapp.com`, `<project>.web.app`, plus any custom domain — _TODO: confirm complete list_ |
| Email enumeration protection | _TODO: confirm setting_ |

**Important:** Adding/removing authorized domains, toggling providers, and managing OAuth clients is **console-only** territory — Terraform's `google` provider does not cover all of these. When Terraform-ifying later, document these as "manual steps" alongside the Terraform plan.

---

## Firebase Storage

| Field | Value |
|-------|-------|
| Default bucket | `rasenbuerosport-leipzig-9d54f.firebasestorage.app` |
| Used for | User avatars, FC26 screenshot uploads |
| Rules | _TODO: paste current `storage.rules` summary, or link to file if checked in_ |

---

## Cloud Scheduler

| Job name | Schedule | Target | Auth |
|----------|----------|--------|------|
| `rbsl-weekly-wrapped` (_TODO: confirm name_) | _TODO: cron, e.g. `0 9 * * MON`_ | `POST <api-url>/api/v1/wrapped/generate` | Custom header with `WRAPPED_TRIGGER_SECRET` |

> The endpoint is gated by `requireSchedulerSecret` middleware. Rotating the secret = update both the Cloud Run env var and the Cloud Scheduler job in the same change window.

---

## Secret Manager

Live secrets (proposed naming — verify and update):

| Secret | Consumer | Rotation |
|--------|----------|----------|
| `rbsl-database-url` | Cloud Run API | When Cloud SQL password rotates |
| `rbsl-anthropic-api-key` | Cloud Run API | When key is rotated in Anthropic console |
| `rbsl-wrapped-trigger-secret` | Cloud Run API + Cloud Scheduler | Rotate yearly or on suspicion |

> _TODO: replace this list with the actual `gcloud secrets list` output once confirmed._

---

## Service Accounts

| SA | Purpose | Key roles |
|----|---------|-----------|
| `api-runtime@…` | Cloud Run service identity for the API | `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`, `roles/firebaseauth.admin` (for token verification), `roles/datastore.user` (only if Firestore is added) |
| `<deployer>@…` | Cloud Build / GitHub Actions deployer | `roles/run.admin`, `roles/iam.serviceAccountUser` on the runtime SA, `roles/artifactregistry.writer`, `roles/firebasehosting.admin` for app deploys |
| `<scheduler>@…` | Cloud Scheduler (if it auths via OIDC instead of shared secret) | `roles/run.invoker` on the API service |

> _TODO: replace with the real list from `gcloud iam service-accounts list` and `gcloud projects get-iam-policy`._

---

## DNS & Domains

| Hostname | Points to | Managed where |
|----------|-----------|---------------|
| _TODO: e.g. `rasenbuerosport.de`_ | Firebase Hosting | _TODO: registrar + DNS zone_ |
| _TODO: e.g. `api.rasenbuerosport.de`_ | Cloud Run (custom domain) | _TODO_ |

---

## CI/CD

- **API**: deployment trigger _TODO_ (Cloud Build on push to `main`? Manual `gcloud run deploy`?)
- **App**: `npm run deploy` runs locally; no automated CI deploy yet
- **DB migrations**: applied manually via `psql` through the Cloud SQL Auth Proxy as part of a release. Migration files live in `migrations/` of the API repo. There is no migration tool wired in yet (e.g. `node-pg-migrate`, `dbmate`).

---

## Known Gaps & Tech Debt

- No Terraform / IaC — this file is the inventory until that lands
- No staging environment — deploys go straight to prod (low-stakes app, but worth flagging)
- Cloud SQL `db-f1-micro` is fine for current load but not HA (single zone, no read replica)
- `scripts/seed.js` still references Supabase and is dead code (kept for historical reference only — see API README)
- No automated DB backups beyond what Cloud SQL does by default — _TODO: confirm retention_
- Secrets rotation is manual — there is no automation

---

## "Day Zero" Checklist (re-create the project from scratch)

If the GCP project disappeared tomorrow, this is the order to rebuild:

1. Create GCP project, enable billing
2. Enable APIs: `run`, `sqladmin`, `secretmanager`, `cloudbuild`, `cloudscheduler`, `artifactregistry`, `firebase`, `firebasehosting`, `identitytoolkit`
3. Create Cloud SQL Postgres 16 instance + `rasenbuerosport` database, set strong password
4. Add Firebase to the project, enable Google sign-in, configure authorized domains
5. Create the runtime service account, grant roles listed above
6. Create secrets in Secret Manager (`rbsl-database-url`, `rbsl-anthropic-api-key`, `rbsl-wrapped-trigger-secret`)
7. Build & push the API container, deploy Cloud Run with Cloud SQL connection + secret bindings
8. Run migrations (`migrations/001_init.sql` ... `006_weekly_wrapped.sql`) via the proxy
9. Import teams (`scripts/import-teams.js`)
10. Configure Cloud Scheduler job for weekly wrapped, point at the new API URL
11. Build & deploy the app to Firebase Hosting
12. Map custom domains (DNS records → Firebase Hosting / Cloud Run domain mapping)
13. Smoke test: sign in → record a game → check leaderboard
