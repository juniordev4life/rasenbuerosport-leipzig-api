# CLAUDE.md - Project Instructions for Claude Code

## Project Overview

This is the **Playmaker** of the RasenBürosport Leipzig stack — the backend REST API powering the office-foosball app. It is a Fastify 5 service that handles authentication, game recording, AI-powered match reports, predictions, and a comprehensive stats engine with 15 unlockable badges.

**Repository roles in the ecosystem:**

- **Playmaker** (API) — Build-up play & data distribution (this repo: `rasenbuerosport-leipzig-api`)
- **Striker** (Application) — Goal scoring & frontend delivery (`rasenbuerosport-leipzig-app`)

There is no separate Coach repo for this project — infrastructure is provisioned manually in GCP (Cloud SQL, Cloud Run, Firebase Hosting, Cloud Scheduler).

This project follows the same architectural patterns as the RB Leipzig engineering-unit stack, but is **independent**: it does **not** use the `@rasenballsport-leipzig/*` shared packages (referee, jersey, tactics) and does **not** depend on the Microsoft Entra ID auth flow.

## Language & Communication

- **All code artifacts must be in English**: JSDoc, comments, documentation, variable names, commit messages
- User communication can be in German, but code output is always English

## Development Philosophies

- **KISS (Keep It Simple, Stupid)** — Prefer the simplest solution that works. Avoid over-engineering, unnecessary abstractions, and premature complexity.
- **DRY (Don't Repeat Yourself)** — Extract shared patterns into local utils/helpers. There are no cross-project shared packages for this stack.
- **YAGNI (You Ain't Gonna Need It)** — Only implement what is currently needed. No speculative configurability.
- **Layered Architecture** — Routes (HTTP interface) → Controllers (request handling) → Services (business logic) → Data Layer (Postgres via `pg`). Dependencies flow top-down.

## Technology Stack

- **Framework**: Fastify 5 with auto-loaded routes (`@fastify/autoload`)
- **Language**: Plain JavaScript only — NO TypeScript (ES Modules, `"type": "module"`)
- **Node.js**: >= 24.0.0
- **Database**: Google Cloud SQL (PostgreSQL 16) via the `pg` driver
- **Authentication**: Firebase Authentication (ID tokens verified by Firebase Admin SDK)
- **AI**: Anthropic Claude Sonnet 4 (text + Vision)
- **Logging**: Pino (structured JSON, Cloud Run compatible)
- **Validation**: JSON Schema (Fastify built-in)
- **Testing**: Vitest
- **Linting/Formatting**: Biome 2.x (no shared config — local `biome.json`)

## Development Server

DO NOT start dev servers automatically. The dev server is either already running or will be started manually.

```bash
npm run dev   # node --watch
npm start     # production start
```

**Default port**: 3001 (the frontend expects `http://localhost:3001`).
On Cloud Run, the runtime sets `PORT=8080`; the server reads `process.env.PORT`.

## Local Database

The recommended local DB is a **Docker Postgres 16 seeded from a PROD snapshot** on `127.0.0.1:5434`. The Cloud SQL Auth Proxy is only used for the one-off snapshot dump.

See `README.md` → *Local Development with a PROD Snapshot* for the full workflow. Default local credentials: user `postgres`, password `localdev`, database `rasenbuerosport`.

## Architecture Pattern

### Request Flow

```
Client Request
  -> Fastify Route (auto-loaded from src/api/routes/, prefix /api)
    -> Authentication Middleware (requireAuth — Firebase ID token)
    -> Schema Validation (JSON Schema, built-in Fastify)
    -> Controller (request handling, error formatting)
      -> Service (business logic, data operations)
        -> Postgres (pg) / Anthropic API
    -> Standard Response (setGeneralResponse helper)
```

### Route Auto-Loading

Routes live under `src/api/routes/` and are auto-loaded with prefix `/api`:

```javascript
// src/api/routes/v1/games/index.js
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

export default async function (fastify) {
  fastify.get("/", {
    schema: getGamesController.schema,
    preHandler: [requireAuth],
    handler: getGamesController.handler,
  });
}
```

Folder names prefixed with `_` become route params: `routes/v1/games/_gameId/index.js` → `/api/v1/games/:gameId`.

### Controller Pattern

Controllers are objects with `schema` and `handler`:

```javascript
export const getGamesController = {
  schema: {
    querystring: gamesQuerySchema,
    response: { 200: gamesResponseSchema },
  },
  handler: async (request, reply) => {
    try {
      const data = await gamesService.getGames(request.user.id, request.query);
      return setGeneralResponse(reply, 200, "Success", "Games retrieved", data);
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  },
};
```

### Standard Response Format

ALL responses go through `setGeneralResponse()` from `src/api/helpers/response.helpers.js`:

```javascript
{
  code: 200,
  title: "Success",
  message: "Games retrieved",
  data: { /* payload */ },
  error: []  // empty array on success
}
```

**Always `return reply.send(...)` (or `return setGeneralResponse(...)` which already calls `reply.send`) in async handlers.** Returning the reply lets Fastify await any response-stream finalization. If `@fastify/compress` is added later, missing `return` causes silent empty-body bugs on payloads ≥ 1024 bytes — see fastify-compress#286 / fastify#6017.

### Service Layer Pattern

Services contain business logic and data access via the `query` / `queryOne` helpers:

```javascript
import { query, queryOne } from "../helpers/database.helpers.js";

export const gamesService = {
  async getGames(userId, { limit = 20 }) {
    return query(
      `SELECT g.* FROM games g
         JOIN game_players gp ON gp.game_id = g.id
        WHERE gp.player_id = $1
        ORDER BY g.played_at DESC
        LIMIT $2`,
      [userId, limit],
    );
  },
};
```

Always use parameterized queries (`$1`, `$2`, …) — never string-interpolate user input.

## Authentication & Authorization

### Token Verification

The frontend signs in with Firebase Authentication (Google Sign-In) and sends the resulting ID token as `Authorization: Bearer <id-token>`.

The `requireAuth` middleware:

1. Extracts the bearer token from the `Authorization` header
2. Verifies it via `getFirebaseAuth().verifyIdToken(token)` (Firebase Admin SDK)
3. Loads the matching `profiles` row from Postgres (id = Firebase `uid`)
4. Attaches `{ id, email, role, username }` to `request.user`

### Credentials

- **Cloud Run (prod)**: Application Default Credentials — the service account has Firebase Admin permissions
- **Local dev**: `gcloud auth application-default login` is sufficient. Fallback: `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`
- `FIREBASE_PROJECT_ID` pins the project the Admin SDK validates tokens against

### Role-Based Access Control

Roles are simple strings stored on `profiles.role`:

```javascript
// src/constants/roles.constants.js
export const ROLES = {
  USER: "user",
  ADMIN: "admin",
};
```

For admin-only routes, check `request.user.role === ROLES.ADMIN` in the controller — there is no `requireRole` middleware yet. If you add one, follow the engineering-unit pattern (`requireRole(role)`, `requireAnyRole([roles])`).

### Public Endpoints

`/health`, `/api/v1/leaderboard`, `/api/v1/seasons*`. Everything else requires `requireAuth`.

### Scheduler Endpoints

`POST /api/v1/wrapped/generate` is protected by `requireSchedulerSecret` (shared-secret header set as `WRAPPED_TRIGGER_SECRET`). Only Cloud Scheduler is meant to call it.

## Database Integration

### Postgres Pool (Singleton)

```javascript
import { getPool } from "../config/database.config.js";
const pool = getPool();
```

The pool reads `DATABASE_URL`. On Cloud Run, this is the Cloud SQL Unix socket path (`/cloudsql/<INSTANCE>`); locally, it points at the Docker Postgres on `127.0.0.1:5434` (or the Cloud SQL Auth Proxy on `5433`).

### Query Helpers

```javascript
import { query, queryOne } from "../helpers/database.helpers.js";

const games = await query("SELECT * FROM games WHERE season_id = $1", [seasonId]);
const profile = await queryOne("SELECT * FROM profiles WHERE id = $1", [userId]);
```

### Schema

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (id = Firebase uid, username, avatar, role) |
| `games` | Match records with scores, timelines, JSONB `match_stats` |
| `game_players` | Links players to games with team assignment |
| `teams` | ~633 real football clubs from 25 European leagues |
| `weekly_wrapped` | Generated weekly recap snapshots |

Authorization is enforced in the API layer — there is no Postgres RLS.

### Migrations

SQL files in `migrations/` are applied manually (or as part of a release). On a fresh local DB:

```bash
PGPASSWORD=localdev psql -h 127.0.0.1 -p 5434 -U postgres -d rasenbuerosport -f migrations/001_init.sql
```

## JSON Schema Validation

Schemas live in `src/api/schemas/{name}.schemas.js`:

```javascript
export const gamesQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    seasonId: { type: "string", format: "uuid" },
  },
};
```

Wire them into the controller's `schema` object: `params`, `querystring`, `body`, `response`.

## Error Handling

Use the shared helper from `src/api/helpers/error.helpers.js`:

```javascript
import { handleErrorResponse } from "../helpers/error.helpers.js";

try {
  const data = await service.getData();
  return setGeneralResponse(reply, 200, "Success", "Data retrieved", data);
} catch (error) {
  return handleErrorResponse(reply, error, request);
}
```

Fastify's global error handler (in `setup.js`) catches schema validation errors and returns the standard response shape.

## Logging

- **Pino** with structured JSON output (parsed by Cloud Logging on Cloud Run)
- Local dev: pretty-printed via `pino-pretty`
- Use `request.log.info({ ... }, "message")` inside handlers; the request id is automatically attached for tracing

## Security

- **Helmet** — security headers via `@fastify/helmet`
- **Rate Limiting** — 250 requests / minute via `@fastify/rate-limit`
- **CORS** — origin from `CORS_ORIGIN` (comma-separated for multiple), credentials enabled
- **Input Validation** — JSON Schema on all endpoints
- Never log secrets (Firebase tokens, `WRAPPED_TRIGGER_SECRET`, `ANTHROPIC_API_KEY`, DB password)

## Code Style

- Plain JavaScript with ES6+ syntax, async/await, destructuring
- ES Modules (`import`/`export`) — `"type": "module"` in package.json
- Tabs for indentation (matches Biome config)
- Use optional chaining (`?.`) and nullish coalescing (`??`) wherever they help
- JSDoc on ALL exported functions with `@param`, `@returns`, and at least one `@example` for non-trivial logic
- Biome handles linting and formatting — run `npm run check` before committing

## File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Controllers | `{name}.controllers.js` | `games.controllers.js` |
| Services | `{name}.services.js` | `games.services.js` |
| Middlewares | `{name}.middlewares.js` | `auth.middlewares.js` |
| Helpers | `{name}.helpers.js` | `response.helpers.js` |
| Schemas | `{name}.schemas.js` | `games.schemas.js` |
| Constants | `{name}.constants.js` | `roles.constants.js` |
| Config | `{name}.config.js` | `database.config.js` |
| Routes | Nested folders with `index.js` | `v1/games/_gameId/index.js` |
| Tests | `{name}.test.js` | `games.services.test.js` |

Folders prefixed with `_` define dynamic route params (e.g. `_gameId` → `:gameId`).

## Project Structure

```
src/
  index.js                     # Entry point (loads .env, starts server)
  server.js                    # Fastify instance creation
  setup.js                     # Plugins (helmet, cors, rate-limit, autoload), routes, /health
  config/
    database.config.js         # pg Pool singleton (DATABASE_URL)
    firebase.config.js         # Firebase Admin SDK singleton
    anthropic.config.js        # Anthropic client singleton
    logger.config.js           # Pino logger config
  constants/
    roles.constants.js         # User role strings
  api/
    routes/v1/                 # Auto-loaded route handlers (prefixed with /api)
      auth/                    # /me, PATCH /profile
      games/                   # CRUD, recent, prediction, _gameId/{match-report,match-stats}
      compare/                 # _player1Id/_player2Id
      duos/                    # /, _player1Id/_player2Id
      leaderboard/             # public
      players/                 # /
      seasons/                 # /, /archive (public)
      stats/                   # /, _playerId
      teams/                   # /
      wrapped/                 # /, /latest, POST /generate (scheduler-auth)
    controllers/               # Request handlers (object with schema + handler)
    middlewares/               # auth (Firebase), schedulerAuth (shared secret)
    services/                  # Business logic and SQL
    schemas/                   # JSON Schema definitions
    helpers/                   # response, error, database
migrations/                    # SQL migration files (001_init.sql, ...)
scripts/                       # One-off scripts (import-teams.js, legacy seed.js)
```

## Testing

```bash
npm test                # vitest run
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
```

- **Framework**: Vitest 4
- **Pattern**: AAA (Arrange-Act-Assert)
- **Mocking**: mock external dependencies — never call the real Firebase, Anthropic, or PROD database in tests
- **Test files**: `{name}.test.js` co-located under `tests/` (mirroring `src/` layout) or alongside the source file
- The repo currently has no `tests/` directory yet — when adding the first test, set up `tests/setup.js` with env-var defaults and shared mocks

## CI/CD

### Git Workflow

Never push directly to `main`. Always use feature branches and pull requests.

- **Branch naming**: `<type>/<short-description>` (e.g., `feat/add-duos-endpoint`, `fix/auth-token-refresh`)
- **PR checks**: GitHub Actions must pass (lint, format, tests)
- **Merge strategy**: Squash merge, delete branch after merge

### Deployment

- **Platform**: Google Cloud Run (Docker image built from `Dockerfile`)
- **Database**: Cloud SQL Postgres 16, reached via the Cloud SQL connector
- **Auth**: Firebase Admin SDK uses the runtime service account's ADC
- **Trigger**: deployment is run from `main` (currently a manual / Cloud Build flow — no Terraform Coach repo exists for this project)

The frontend (`rasenbuerosport-leipzig-app`) is deployed to **Firebase Hosting**, not GCS+CDN. Keep CORS origins in sync between API config and the deployed Firebase Hosting URL.

## Commit Messages

Follow Conventional Commits:

```
<type>[optional scope]: <description>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Breaking changes: `feat(api)!: rename /stats/me to /stats`

## Code Review Standards

After completing any implementation, review the code for:

- Functions longer than 30 lines (likely doing too much — split them)
- Logic duplicated more than twice (extract to a util/helper)
- Exported functions without JSDoc — every one needs name, description, `@param`, `@returns`, and at least one `@example` for non-trivial behavior
- Routes with more than 3 query/body fields that could be grouped into a sub-object schema
- Missing error handling on async operations
- Raw SQL with string interpolation instead of parameterized queries
- New endpoints not reflected in `README.md` → API Endpoints table
