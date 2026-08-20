<div align="center">

# RasenBürosport Leipzig API

**The Backend Powering Office Kicker Legends**

![Version](https://img.shields.io/badge/version-v1.8.2-blue)

Fastify 5 REST API with Claude AI integration, Firebase authentication, Cloud SQL Postgres, and a comprehensive stats engine for tracking foosball matches.

---

[API Endpoints](#api-endpoints) · [AI Features](#-ai-features) · [Stats Engine](#-stats-engine) · [Authentication](#-authentication) · [Database](#-database) · [Getting Started](#-getting-started)

---

</div>

## What Is This?

The RasenBürosport Leipzig API is the backend service (Playmaker) that powers the [RasenBürosport Leipzig App](https://github.com/juniordev4life/rasenbuerosport-leipzig-app). It handles everything from user authentication and game recording to AI-powered match reports, predictions, and a full-featured statistics engine with 15 unlockable badges.

---

## Architecture

```
Client Request
  → Fastify Route (auto-loaded from src/api/routes/)
    → Authentication Middleware (Firebase ID token)
    → JSON Schema Validation (params, query, body)
    → Controller (request/response handling)
      → Service (business logic)
        → Cloud SQL Postgres (pg) / Claude API
    → Standardized JSON Response
```

In production, Cloud Run reaches Cloud SQL via the built-in Cloud SQL connector. Locally, the Cloud SQL Auth Proxy (or a Docker Postgres with a snapshot — see below) provides the same `DATABASE_URL` interface.

The API follows a strict **layered architecture** — Routes define endpoints, Controllers handle HTTP concerns, and Services contain all business logic and data access.

---

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Framework** | Fastify | 5.7 |
| **Runtime** | Node.js | >= 24.0 |
| **Language** | JavaScript (ES Modules) | — |
| **Database** | Google Cloud SQL (PostgreSQL 16) via `pg` | 8.x |
| **Auth** | Firebase Authentication (Admin SDK verifies ID tokens) | 13.x |
| **Hosting** | Google Cloud Run (API), Firebase Hosting (Frontend) | — |
| **AI Model** | Claude Sonnet 4 (Anthropic) | — |
| **AI Vision** | Claude Vision API | — |
| **Security** | Helmet, CORS, Rate Limiting | — |
| **Validation** | JSON Schema (Fastify built-in) | — |
| **Logging** | Pino (structured JSON) | — |
| **Linting** | Biome | 2.4 |
| **Testing** | Vitest | 4.0 |

---

## API Endpoints

### Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | — | Health check |
| `GET` | `/api/v1/auth/me` | Bearer | Get current user profile |
| `PATCH` | `/api/v1/auth/profile` | Bearer | Update current user profile |
| `GET` | `/api/v1/games` | Bearer | Get user's game history |
| `POST` | `/api/v1/games` | Bearer | Create a new game |
| `GET` | `/api/v1/games/recent` | Bearer | Global activity feed |
| `GET` | `/api/v1/games/:gameId` | Bearer | Get game details |
| `POST` | `/api/v1/games/:gameId/match-stats` | Bearer | Extract stats from FC26 screenshot |
| `DELETE` | `/api/v1/games/:gameId/match-stats` | Bearer | Remove match stats |
| `POST` | `/api/v1/games/:gameId/match-report` | Bearer | Generate reporter-style AI match report (Buschmann/Reif tone) |
| `POST` | `/api/v1/games/:gameId/match-report/audio` | Bearer | Render the report as mp3 via ElevenLabs TTS (cached on Firebase Storage) |
| `POST` | `/api/v1/games/prediction` | Bearer | Generate AI match prediction |
| `PATCH` | `/api/v1/games/:gameId` | Agent | Office agent / highlight pipeline reports `video_status` (+ optional `highlight_url`) |
| `GET` | `/api/v1/recording/next` | Agent | Office agent polls the next recording command (`start` / `stop` / `idle`) |
| `POST` | `/api/v1/recording/command` | Bearer | App sets the next command — `start` on kickoff (provisional recording id), `stop` after saving (real game id), `abort` on cancel |
| `POST` | `/api/v1/recording/report` | Agent | Office agent reports capture state (`recording` / `failed` / `stopped` / `aborted`) for the provisional recording id |
| `GET` | `/api/v1/recording/status` | Bearer | App polls the agent-reported capture state for its recording id during the live step |
| `GET` | `/api/v1/recording/timeline` | Agent | Office agent fetches a game's tap timeline + lineup for the highlight pipeline's anchor mode |
| `POST` | `/api/v1/recording/finalize` | Agent | Pipeline delivers the vision-extracted timeline for a PENDING game — writes score (plus `result_type` / `penalty_shootout` when a shootout was detected), runs deferred ELO/push |
| `POST` | `/api/v1/recording/stats` | Agent | Pipeline submits stats-screen URLs pulled from the recording; reuses the Claude-Vision extraction |
| `GET` | `/api/v1/leaderboard` | — | Get leaderboard standings |
| `GET` | `/api/v1/players` | Bearer | Get all player profiles |
| `GET` | `/api/v1/stats` | Bearer | Get comprehensive user stats |
| `GET` | `/api/v1/stats/:playerId` | Bearer | Head-to-head vs specific player |
| `GET` | `/api/v1/compare/:player1Id/:player2Id` | Bearer | Compare two players |
| `GET` | `/api/v1/duos` | Bearer | List teammate duos |
| `GET` | `/api/v1/duos/:player1Id/:player2Id` | Bearer | Detail for a specific duo |
| `GET` | `/api/v1/seasons` | — | List seasons |
| `GET` | `/api/v1/seasons/archive` | — | Season archive |
| `GET` | `/api/v1/teams` | Bearer | Get all available teams |
| `GET` | `/api/v1/wrapped` | Bearer | List user's weekly wrapped entries |
| `GET` | `/api/v1/wrapped/latest` | Bearer | Latest weekly wrapped (totals, highlights, embedded talkrunde status) |
| `GET` | `/api/v1/wrapped/:weekStart` | Bearer | Deep-link to a specific week (YYYY-MM-DD, Monday of the target week) |
| `POST` | `/api/v1/wrapped/generate` | Scheduler | Trigger weekly wrapped generation (Cloud Scheduler only) |
| `POST` | `/api/v1/talkshow/generate` | Scheduler | Generate weekly talkshow episode — Claude script + multi-speaker ElevenLabs mp3 (Cloud Scheduler only) |
| `GET` | `/api/v1/talkshow/latest` | Bearer | Latest persisted talkshow episode (week, audio URL, turn count, summary) — feeds the dashboard Talkrunde card |
| `POST` | `/api/v1/talkshow/_preview` | Bearer | Debug: regenerate the current week's drehbuch (optionally without persisting) |
| `POST` | `/api/v1/talkshow/audio` | Bearer | Re-render the audio for a persisted episode (idempotent — returns cached `audio_url` if already rendered) |
| `POST` | `/api/v1/feedback` | Bearer | Submit in-app feedback (general → email via Resend, bug/feature → GitHub issue) |
| `GET` | `/api/v1/players/:playerId/trophies` | Bearer | Player trophy room — all 64 trophies with unlocked-state, progress on threshold trophies, hidden trophies masked until unlocked |

> User registration and login happen client-side via Firebase Authentication in the frontend. The API never issues credentials — it only verifies Firebase ID tokens supplied as `Authorization: Bearer <id-token>`.

[Full API Documentation →](docs/features/API_ENDPOINTS.md)

---

## AI Features

Three AI features powered by **Claude Sonnet 4** make RasenBürosport unique:

### 1. FC26 Stats Extraction (Vision)

Upload a screenshot of FC26's post-match statistics screen. **Claude Vision** analyzes the image and automatically extracts all 18 stat categories — from possession and xG to yellow cards and dribbling success rate. Works with German and English game language.

### 2. Match Prediction

When players and teams are selected in the game wizard, the API generates a pre-match prediction based on career statistics, H2H records, current form, and xG efficiency. The prediction is entertaining, data-driven, and includes a score estimate.

### 3. Match Report (Multi-Reporter)

After a game with FC26 statistics, the API generates a German-language **reporter-style** match commentary (60–90 words). The text is narrated by one of three reporter personas — **Der Klassiker** (Buschmann/Reif tone), **Der Analyst** (data-driven, precise) or **Der Euphoriker** (energetic, spectacular) — picked per match by `selectReporter()` (`src/api/utils/selectReporter.utils.js`).

Selection pipeline:
1. **Hard rules** — comeback / hattrick → Euphoriker; clear win without drama → Analyst; early red card → Klassiker.
2. **Drama-weighted random** — fallback uses per-drama-level probability tables.
3. **Anti-repetition** — if the last two reports were narrated by the same persona, that persona's weight is divided by four.

The chosen persona drives both the prompt (`buildReporterPrompt(reporterId)` injects a persona-specific block and one-shot example into the shared scaffold) and the TTS voice. The selected `reporter_id` is persisted on the game row. Re-generating the report invalidates the cached audio so it can be re-rendered with the new persona's voice.

### 4. Audio Match Report

`POST /api/v1/games/:gameId/match-report/audio` renders the reporter text to an mp3 via **ElevenLabs v3** (model `eleven_v3`). Voice ID and tuning (`stability`, `similarity_boost`, `style`) are persona-specific (see `src/constants/reporters.constants.js`); persona voice IDs live in `ELEVENLABS_VOICE_ID_KLASSIKER` / `_ANALYST` / `_EUPHORIKER` with a fallback to the shared `ELEVENLABS_VOICE_ID`. A pronunciation map (`src/constants/playerPronunciation.constants.js`) rewrites tricky usernames before TTS. The mp3 is uploaded to Firebase Storage (`match-reports/<gameId>.mp3`), made public, and the URL is cached on the game row — subsequent calls skip the TTS roundtrip.

[Full AI Documentation →](docs/features/AI_FEATURES.md)

---

## Stats Engine

The stats engine computes comprehensive player analytics from game data:

### Career Statistics

| Metric | Description |
|--------|-------------|
| **Win Rate** | Overall win percentage |
| **Mode Split** | Separate 1v1 and 2v2 records |
| **Current Streak** | Active win/loss streak (draws don't break) |
| **Favorite Opponent** | Most frequent opponent |
| **Best Teammate** | Highest win rate partner (min. 2 games) |
| **Favorite Team** | Most selected team |

### Career Match Stats (FC26)

Aggregated averages from all games with uploaded FC26 data:

| Metric | Example |
|--------|---------|
| **Avg Possession** | 54% |
| **Avg Pass Accuracy** | 88% |
| **xG Efficiency** | 1.08x |
| **Avg Duel Win Rate** | 59% |

### 15 Unlockable Badges

| Badge | Name | Condition |
|-------|------|-----------|
| 🎯 | Tiki-Taka | Avg pass accuracy > 85% (min 3 games) |
| 🧲 | Ball Magnet | Avg possession > 55% (min 3 games) |
| ⚡ | Counter King | Win with < 40% possession |
| 🔫 | xG Killer | xG efficiency > 1.3 (min 5 games) |
| 💪 | Duel Monster | Avg duel win rate > 60% (min 3 games) |
| 💎 | Perfectionist | 100% pass accuracy in one game |
| 🎉 | Goal Fest | 5+ goals in a single game |
| 🛡️ | Clean Sheet | Win without conceding |
| 🏹 | David vs Goliath | Win with < 30% possession |
| 🤝 | Fair Play | 10+ games without yellow card |
| 👶 | Debutant | First game played |
| ⭐ | Regular | 25+ games played |
| 👑 | Club Legend | 100+ games played |
| ⚽ | Top Scorer | 50+ career goals |
| 🔥 | Streak Master | 5+ win streak (historical) |

[Full Stats & Badges Documentation →](docs/features/STATS_ENGINE.md)

---

## Authentication

The API uses **Firebase Authentication** with ID-token verification:

1. The frontend signs in via Firebase Auth (Google Sign-In) and obtains a Firebase ID token
2. Each API request sends the token as `Authorization: Bearer <id-token>`
3. The `requireAuth` middleware verifies the token via the **Firebase Admin SDK** (`getFirebaseAuth().verifyIdToken`)
4. The decoded user (`uid`, `email`) is attached to `request.user`, then enriched with the matching `profiles` row (role, username) from Postgres

**Credentials**

- **Cloud Run (prod):** Application Default Credentials — the runtime service account is granted Firebase Admin permissions
- **Local dev:** `gcloud auth application-default login` is sufficient — no service account JSON needed. As a fallback, set `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`
- The `FIREBASE_PROJECT_ID` env var pins the project the Admin SDK validates tokens against

**Public endpoints:** `/health`, `/api/v1/leaderboard`, `/api/v1/seasons*`. Everything else requires a Bearer token. The internal `/api/v1/wrapped/generate` and `/api/v1/talkshow/generate` endpoints use a separate scheduler-secret middleware for Cloud Scheduler.

**Agent endpoints:** `GET /api/v1/recording/next`, `POST /api/v1/recording/report`, `GET /api/v1/recording/timeline` and `PATCH /api/v1/games/:gameId` authenticate via the `X-Agent-Secret` header (`AGENT_SECRET` env var, `requireAgentSecret` middleware) — machine auth for the office recording agent (`rasenbuerosport-leipzig-capture`), same pattern as the scheduler secret. The flow: the app POSTs `start` to `/v1/recording/command` on kickoff with a client-generated provisional recording id (the game row does not exist until after the final whistle), the agent polls `/v1/recording/next` and records; after saving, the app POSTs `stop` with the real game id, and the agent runs the highlight pipeline (extract goals → cut a reel → upload it public to Storage) and PATCHes `video_status` onto the game row: `processing` while the reel builds, then `ready` + `highlight_url` (or `failed`). The app renders `highlight_url` straight from the game response (`<video>`), polling while `processing` — no file lookups. A leftover `start` older than 3 h is served as `idle` (stale-start guard).

**Zero-tracking flow (pending games):** When nobody taps goals during a match, the app saves the game as `pending: true` (0:0, empty timeline) — `createGame` then skips ELO, profile-cache invalidation and the match push. The capture pipeline extracts the real timeline from the recording (events screen via Claude Vision), POSTs it to `/v1/recording/finalize`, which writes score + timeline, flips `pending` off and runs the deferred scoring tail. A non-pending game is refused with 409 so ELO can never apply twice. The pipeline can also submit the stats screens it finds in the recording via `/v1/recording/stats` — same extraction + merge as the manual screenshot upload, which unlocks the match report exactly the same way.

A detected shootout travels **with** the finalize call, not on the later `video_status` PATCH. Finalize is where the deferred ELO runs, and the engine needs to know the match was decided — reported afterwards it arrives too late and the shootout win is rated as a draw, i.e. zero. The PATCH still accepts the same fields (COALESCE, idempotent) so a non-pending game whose shootout is only detected in the video still gets it recorded.

**Recording status back-channel:** `recording_command` is one-way (app → agent), so a second single-row slot, `recording_status`, carries the reverse direction (agent → app). The agent POSTs `/v1/recording/report` with the provisional recording id and a state — `recording` once ffmpeg is confirmed alive, `failed` if it died on launch, `stopped`/`aborted` when capture ends. The app polls `GET /v1/recording/status?recording_id=…` during the live step: on `failed` (or its own timeout, when the agent is offline and never reports) it shows an error dialog offering retry or play-without-recording. `abort` (vs. `stop`) tells the agent to stop ffmpeg and **delete** the file — sent when the user backs out of the live step or dismisses the error dialog; the recording is discarded, not linked to a game.

A reported `failed`/`aborted` capture is also carried onto the **game row**, not just the status slot: `reportRecordingStatus` sets `video_status = 'failed'` on any game with that `recording_id` whose status is still empty, and `createGame` adopts the failure for a game created *after* the report (the usual case — ffmpeg dying on launch is reported before the game row exists, so there is nothing to update at that moment). Without this the game keeps `video_status = NULL`, and the app blocks the match report indefinitely: its game detail page treats "`recording_id` set + status neither `ready` nor `failed`" as "pipeline still running" and shows a preparing spinner. That happened to six games in August 2026 when a full disk made ffmpeg die instantly on every start.

[Full Auth Documentation →](docs/features/AUTHENTICATION.md)

---

## Database

### Google Cloud SQL (PostgreSQL 16)

| Table | Purpose |
|-------|---------|
| **profiles** | User profiles (username, avatar, role) — `id` matches the Firebase Auth `uid` |
| **games** | Match records with scores, timelines, stats |
| **game_players** | Links players to games with team assignment |
| **teams** | ~633 real football clubs from 25 European leagues |
| **weekly_wrapped** | Generated weekly recap snapshots |

Key features: JSONB columns for match stats and score timelines, foreign-key relationships, indexes on hot query paths. Authorization is enforced in the API layer (no Postgres RLS — auth flows through the Firebase token + `profiles.role`).

**Connectivity**

- **Cloud Run:** uses the Cloud SQL connector (`/cloudsql/<INSTANCE>` Unix socket) — `pg` reads `DATABASE_URL`
- **Local dev:** Cloud SQL Auth Proxy on `127.0.0.1:5433`, or a local Docker Postgres seeded from a PROD snapshot (recommended — see *Local Development with a PROD Snapshot* below)

[Full Database Documentation →](docs/features/DATABASE.md)

---

## Supported Leagues

The app includes ~400 real football clubs from **25 European top leagues** (curated from Transfermarkt):

| # | Country | League | Teams |
|---|---------|--------|-------|
| 1 | England | Premier League | 20 |
| 2 | Spain | La Liga | 20 |
| 3 | Italy | Serie A | 20 |
| 4 | Germany | Bundesliga | 18 |
| 5 | France | Ligue 1 | 18 |
| 6 | Portugal | Liga Portugal | 18 |
| 7 | Netherlands | Eredivisie | 18 |
| 8 | Turkey | Süper Lig | 18 |
| 9 | Poland | Ekstraklasa | 18 |
| 10 | Belgium | Jupiler Pro League | 16 |
| 11 | Russia | Premier Liga | 16 |
| 12 | Ukraine | Premier Liga | 16 |
| 13 | Czech Republic | Chance Liga | 16 |
| 14 | Norway | Eliteserien | 16 |
| 15 | Serbia | Super Liga | 16 |
| 16 | Romania | Superliga | 16 |
| 17 | Sweden | Allsvenskan | 16 |
| 18 | Bulgaria | efbet Liga | 16 |
| 19 | Greece | Super League 1 | 14 |
| 20 | Israel | Ligat ha'Al | 14 |
| 21 | Denmark | Superliga | 12 |
| 22 | Scotland | Premiership | 12 |
| 23 | Austria | Bundesliga | 12 |
| 24 | Switzerland | Super League | 12 |
| 25 | Croatia | SuperSport HNL | 10 |

### Updating Teams

Team data is sourced from SoFIFA (FC 26 ratings) and refreshed with a single command:

```bash
DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5433/rasenbuerosport" npm run teams:update
```

This runs the three-stage pipeline in order:

1. `scripts/parse-sofifa-leagues.js` — parses the saved SoFIFA league RTF files in `ligen/` and regenerates `scripts/scraped-teams.json`.
2. `scripts/import-teams.js` — upserts every team into Cloud SQL via `INSERT … ON CONFLICT (name) DO UPDATE`. Existing teams are matched by name, so **UUIDs are preserved**; `logo_url`, `sofifa_id`, `overall_rating`, `star_rating`, `league_name`, and `country_code` are refreshed. This step writes SoFIFA-CDN logo URLs.
3. `scripts/update-logo-urls.js` — rewrites `logo_url` from the SoFIFA CDN back to the Firebase Storage bucket, so logos stay self-hosted. Bundling this in means the re-hosting can't be forgotten.

`DATABASE_URL` is required and checked **up front** — a missing connection string aborts before any parsing. Point it at the Cloud SQL Auth Proxy (`npm run db:proxy`, port 5433) for PROD, or at your local Docker Postgres (port 5434). Each step is transactional; a non-zero exit aborts the run before the next step.

A brand-new club added during a run gets a Firebase URL whose image may not be in the bucket yet (404). Fetch and upload missing logos with `scripts/download-logos.js`.

> `migrations/migrate-teams.js` is the original one-off bootstrap (CSV-based, `DELETE FROM teams` first, then downloads + uploads logos). It is **destructive** — do not use it for incremental updates.

---

## Correcting a Recorded Match

Swapping a player in an already-recorded game is not a one-row update. The player id is denormalized into the game's JSONB blobs, and it is spelled differently in each:

| Location | Fields |
|----------|--------|
| `game_players` | `player_id` |
| `score_timeline` → goal | `scored_by`, `assist_by` |
| `score_timeline` → `red_card` / `card` | `player_id` |
| `score_timeline` → `penalty_missed` | `shooter_id`, `keeper_id` |
| `penalty_shootout.shots[]` | `shooter_id`, `keeper_id`, **`elo_deltas` keys** |
| `games.elo_snapshot` | player-keyed (rebuilt by the recompute) |

The `elo_deltas` keys are the trap. Swap only the lineup row and a replay hands the shootout deltas straight back to the player who was just removed — silently undoing the correction.

`scripts/swap-game-player.js` rewrites all of them in one transaction:

```bash
npm run game:swap-player -- --game=<uuid> --from=Hendrik --to=Alex --dry-run
npm run game:swap-player -- --game=<uuid> --from=Hendrik --to=Alex --apply --backup
```

`--from` and `--to` accept a profile id or a username (case-insensitive, ambiguity is an error). The script also clears `elo_snapshot`, nulls `profile_cache` for both players, and clears `match_report` plus its audio — the report narrates the old lineup by name, so leaving it would display a stale, wrong text. Keep it with `--keep-report`. Regenerate afterwards with `POST /api/v1/games/<id>/match-report`.

Left alone on purpose: `match_stats` (team-level counts), the pass networks (jersey numbers), `reporter_id` (AI persona), `created_by` (who recorded it), and `game_players.rating` (the slot's performance rating, carried over).

Two players who **both** already played cannot be swapped this way — `UNIQUE(game_id, player_id)` forbids it, and exchanging their teams is a different operation. The script refuses with that explanation rather than failing on the constraint.

Roll back by running the same command with `--from` and `--to` reversed.

**Full runbook for a lineup correction:**

1. `npm run game:swap-player -- --game=… --from=… --to=… --dry-run` — check the change set
2. Same command with `--apply --backup`
3. `npm run elo:recompute -- --apply --backup` — see below; a pending game skips this step
4. `POST /api/v1/games/<id>/match-report` — regenerate the report
5. Fix trophies by hand if the match unlocked any (see below)

---

## Recomputing ELO

When a recorded match has to be corrected after the fact — a wrong player in the lineup, a mis-tapped goal — the rating that came out of it is wrong too, and so is every rating computed after it. ELO is path-dependent: each match starts from the rating the previous one left behind. There is no way to patch a single match in place.

`scripts/recompute-all-elo.js` replays the full history:

```bash
npm run elo:recompute -- --dry-run
npm run elo:recompute -- --apply --backup
```

`--dry-run` reports what would happen and touches nothing. `--apply` resets every profile to 1500 and then walks all finalized games oldest-first. `--backup` writes a JSON dump of all ratings and snapshots beforehand; restore it with `--restore=scripts/.elo-backup-<ts>.json` if the result looks wrong.

Each game goes through the same three passes the live save path applies, in the same order — team engine, penalty-shootout overlay, card overlay. That sequence lives in `src/api/services/elo/eloReplay.services.js` and is shared by both paths, so a new pass added to one cannot be forgotten in the other. The overlays are re-applied only where the stored row proves they ran the first time: `penalty_shootout.shots[]` carries its per-shot deltas verbatim, and `match_stats.card_elo_applied` records that a defense screenshot was charged. That flag is read, never written — the live path owns it, so a later re-upload still correctly skips.

Pending games are excluded. Their real result does not exist yet, and `finalizeGame` applies their ELO once the capture pipeline delivers it.

### Shootouts count as wins

The league plays extra time and penalties — there are no draws. A match decided in a shootout is therefore rated as a **win** for the shootout winner, not as a draw on the level regular-time score. Two things have to move together for that, and missing either one silently produces zero: `actualScore` (1 / 0 instead of 0.5) **and** the margin factor, because `computeMarginFactor(0, …)` is 0 and would multiply the whole delta away. A shootout is the narrowest win there is, so it borrows the margin of a one-goal win.

The rule reads `penalty_shootout.winner_side` off the game row, so it works for both shapes: the manual one with `shots[]` and the result-only one the capture pipeline writes. The per-shot overlay is unchanged and still applies on top where shots exist — it rates individual takers, which is a different thing from who won.

Because ELO is path-dependent, games finalized **before** this rule existed still carry their draw ratings. Run `npm run elo:recompute -- --apply --backup` once to apply it to the history.

**`--since` is not a partial recompute.** The reset has no `WHERE` clause, so it clears every profile and every snapshot regardless of the cutoff — replaying only the tail would leave all earlier history blank. The script refuses `--apply --since=…` for that reason. It is allowed together with `--skip-reset`, which is the resume-a-crashed-run case.

Two things the replay does **not** fix, because they are not derived from the games table:

- **Trophies are append-only.** `mergeTrophies` in `scripts/trophy-backfill.js` skips entries that already exist and never revokes one. A badge earned through a match that later changed stays awarded, and `duo_trophies` is keyed on the player pair, so a changed lineup means a different row. Both need manual JSONB edits.
- **Anything already delivered.** Push notifications name the players in their body and are long gone from the server. Generated match-report audio is uploaded `immutable` with a one-year max-age, so CDN and browser copies keep serving the old narration for a while even after a regeneration.

---

## Security

| Layer | Implementation |
|-------|---------------|
| **Helmet** | Security headers (CSP, X-Frame-Options, etc.) |
| **CORS** | Configurable origin (default: `localhost:5173`) |
| **Rate Limiting** | 250 requests per minute per IP |
| **Token Verification** | Firebase ID token validation via Firebase Admin SDK |
| **Scheduler Auth** | Shared secret on `POST /wrapped/generate` (Cloud Scheduler) |
| **Input Validation** | JSON Schema on all endpoints |
| **Standardized Errors** | Consistent error response format |

---

## Response Format

All endpoints return a standardized JSON response:

```json
{
  "code": 200,
  "title": "Success",
  "message": "Games retrieved",
  "data": { },
  "error": []
}
```

Error responses follow the same structure with appropriate status codes and error messages in the `error` array.

---

## Getting Started

### Prerequisites

- Node.js >= 24.0
- Google Cloud SDK (`gcloud`) authenticated (`gcloud auth login` + `gcloud auth application-default login`)
- Cloud SQL Auth Proxy (or Docker for the PROD-snapshot workflow below)
- Firebase project access (`rasenbuerosport-leipzig-9d54f`) for token verification
- Anthropic API key (for AI features)

### Environment Variables

Create a `.env` file in the project root (see `.env.example`):

```env
PORT=3001
HOST=0.0.0.0
NODE_ENV=development

# Postgres connection. Locally either to the Cloud SQL Proxy (5433) or a local Docker Postgres (5434).
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5434/rasenbuerosport

# Firebase Admin SDK — Cloud Run uses Application Default Credentials automatically.
# For local dev, `gcloud auth application-default login` is enough.
# Optional fallback: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
FIREBASE_PROJECT_ID=rasenbuerosport-leipzig-9d54f

ANTHROPIC_API_KEY=sk-ant-...
WRAPPED_TRIGGER_SECRET=<shared-secret-for-cloud-scheduler>

# In-app feedback. RESEND_API_KEY routes "general" feedback to FEEDBACK_RECIPIENT_EMAIL via Resend.
# FEEDBACK_GITHUB_TOKEN is a fine-grained PAT with "Issues: write" on FEEDBACK_GITHUB_REPO; it files bug/feature feedback as GitHub issues.
RESEND_API_KEY=re_...
FEEDBACK_GITHUB_TOKEN=github_pat_...
# Optional overrides — all have sensible defaults:
# FEEDBACK_GITHUB_REPO=juniordev4life/rasenbuerosport-leipzig-app
# FEEDBACK_RECIPIENT_EMAIL=marco.slusalek@redbulls.com
# FEEDBACK_SENDER_EMAIL=onboarding@resend.dev (sandbox; verify a domain in Resend for arbitrary recipients)

CORS_ORIGIN=http://localhost:5173
```

### Installation

```bash
npm install
```

To talk directly to PROD via the Cloud SQL Auth Proxy (read-only use cases like `pg_dump`):

```bash
npm run db:proxy
```

Runs `scripts/db-proxy.sh`, which pre-flights your gcloud auth (prints the active account/project and reminds you to run `gcloud auth application-default login` if ADC is missing), then starts `cloud-sql-proxy …:rasenbuerosport-db` on port 5433. The proxy runs in the foreground — Ctrl+C to stop. It authenticates via IAM (ADC), not a DB password. Instance and port can be overridden with `CLOUD_SQL_INSTANCE` / `CLOUD_SQL_PROXY_PORT`.

### Development

```bash
npm run dev          # Start with --watch (auto-reload)
```

The API runs on `http://localhost:3001` by default.

### Legacy Seed Script

`scripts/seed.js` is a legacy Supabase-based seeder kept only for historical reference. It targets a Supabase project that no longer exists and **will not work** against the current Cloud SQL + Firebase Auth stack. Use the **PROD snapshot workflow** below instead.

### Local Development with a PROD Snapshot

The recommended local setup is a Docker-based Postgres 16 with a one-off snapshot pulled from the production Cloud SQL instance via the Auth Proxy. **PROD is read-only in this flow** — `pg_dump` only reads.

**Prerequisites**

- Docker Desktop running
- `cloud-sql-proxy`, `pg_dump`, `psql` installed (`pg_dump` ≥ 16; if you have `pg_dump` ≥ 17, see the note about `transaction_timeout` below)
- `gcloud auth login` and `gcloud auth application-default login` done, project set to `rasenbuerosport-leipzig-9d54f`, role **Cloud SQL Client**

**1. Dump PROD via the Cloud SQL Auth Proxy**

In one terminal, start the proxy on port 5433:

```bash
npm run db:proxy
```

In another terminal, dump (uses the PROD `DATABASE_URL` from `.env`):

```bash
set -a; source .env; set +a
pg_dump "$DATABASE_URL" --no-owner --no-acl --format=plain --file=$HOME/rbsl-prod-dump.sql
```

Stop the proxy once the dump finishes (`Ctrl+C` in its terminal).

**2. Start a local Postgres 16 in Docker on port 5434**

Port 5434 avoids clashing with the proxy on 5433.

Quick path — `npm run db:local` creates the container (or resumes it if it already exists) and waits until Postgres is ready. The manual equivalent:

```bash
docker run -d \
  --name rbsl-pg \
  -e POSTGRES_PASSWORD=localdev \
  -e POSTGRES_DB=rasenbuerosport \
  -p 5434:5432 \
  -v rbsl-pg-data:/var/lib/postgresql/data \
  postgres:16

# Wait until ready
until docker exec rbsl-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
```

**3. Restore the dump**

If you used `pg_dump` ≥ 17 against PG 16, strip the unsupported `SET transaction_timeout` line first:

```bash
sed -i.bak '/^SET transaction_timeout/d' $HOME/rbsl-prod-dump.sql
```

Restore:

```bash
PGPASSWORD=localdev psql -h 127.0.0.1 -p 5434 -U postgres -d rasenbuerosport \
  -v ON_ERROR_STOP=1 -f $HOME/rbsl-prod-dump.sql
```

Verify:

```bash
PGPASSWORD=localdev psql -h 127.0.0.1 -p 5434 -U postgres -d rasenbuerosport \
  -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"
```

**4. Point the API at the local DB**

In `.env`, comment the PROD `DATABASE_URL` and add the local one:

```env
# PROD via Cloud SQL Proxy (port 5433): postgresql://postgres:<prod-pw>@127.0.0.1:5433/rasenbuerosport
DATABASE_URL=postgresql://postgres:localdev@127.0.0.1:5434/rasenbuerosport
```

Then `npm run dev` — the API now runs against your local snapshot.

**Lifecycle commands**

```bash
docker stop rbsl-pg          # pause
docker start rbsl-pg         # resume (data persists in volume rbsl-pg-data)
docker rm -f rbsl-pg && docker volume rm rbsl-pg-data   # full reset
```

**Refresh the snapshot later** — repeat steps 1 and 3 (drop and recreate the DB inside the container if you want a clean slate):

```bash
docker exec -e PGPASSWORD=localdev rbsl-pg psql -U postgres -c "DROP DATABASE rasenbuerosport;"
docker exec -e PGPASSWORD=localdev rbsl-pg psql -U postgres -c "CREATE DATABASE rasenbuerosport;"
```

### Production

```bash
npm start
```

### Linting & Formatting

```bash
npm run check        # All checks with auto-fix
npm run lint:check   # Lint only (no fix)
npm run format:check # Format only (no fix)
```

### Testing

```bash
npm test             # Run tests
npm run test:watch   # Watch mode
npm run test:coverage # With coverage report
```

---

## Project Structure

```
backend/
├── scripts/
│   ├── seed.js                          # Demo data generator
│   └── invite.js                        # User invitation script
├── src/
│   ├── index.js                         # Entry point
│   ├── server.js                        # Fastify instance
│   ├── setup.js                         # Plugin & route registration
│   ├── config/
│   │   ├── database.config.js           # pg Pool singleton (Cloud SQL / local Postgres)
│   │   ├── firebase.config.js           # Firebase Admin SDK singleton
│   │   ├── anthropic.config.js          # Anthropic client singleton
│   │   └── logger.config.js             # Pino logger config
│   ├── constants/
│   │   ├── roles.constants.js           # User role definitions
│   │   └── feedback.constants.js        # Feedback recipient / GitHub repo / labels
│   └── api/
│       ├── routes/v1/                   # Auto-loaded route handlers
│       │   ├── auth/                    # /me, PATCH /profile (Firebase-backed)
│       │   ├── games/                   # Game CRUD & sub-routes
│       │   │   ├── recent/              # Activity feed
│       │   │   ├── prediction/          # AI match prediction
│       │   │   └── _gameId/             # Game detail & sub-resources
│       │   │       ├── match-report/    # AI match report
│       │   │       └── match-stats/     # FC26 stats extraction
│       │   ├── compare/                 # Player vs player comparison
│       │   ├── duos/                    # Teammate duos
│       │   ├── leaderboard/             # Rankings (public)
│       │   ├── players/                 # Player profiles
│       │   ├── seasons/                 # Seasons + archive (public)
│       │   ├── stats/                   # User stats & H2H
│       │   ├── teams/                   # Team catalog
│       │   ├── wrapped/                 # Weekly wrapped (Cloud Scheduler trigger)
│       │   └── feedback/                # In-app feedback (Resend mail + GitHub issues)
│       ├── controllers/                 # Request handlers
│       ├── middlewares/                 # auth (Firebase), schedulerAuth (shared secret)
│       ├── services/                    # Business logic layer
│       ├── schemas/                     # JSON Schema definitions
│       ├── middlewares/                 # Auth middleware
│       └── helpers/                     # Response & error helpers
└── package.json
```

---

## Related Repository

| Repository | Description |
|-----------|-------------|
| [rasenbuerosport-leipzig-app](https://github.com/juniordev4life/rasenbuerosport-leipzig-app) | Frontend (Svelte 5, SvelteKit, TailwindCSS 4) |

---

<div align="center">

---

**RasenBürosport Leipzig API** — Where office kicker meets data engineering.

*Built with passion and AI*

</div>
