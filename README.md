<div align="center">

# RasenBürosport Leipzig API

**The Backend Powering Office Kicker Legends**

Fastify 5 REST API with Claude AI integration, Supabase authentication, and a comprehensive stats engine for tracking foosball matches.

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
    → Authentication Middleware (Supabase JWT)
    → JSON Schema Validation (params, query, body)
    → Controller (request/response handling)
      → Service (business logic)
        → Supabase PostgreSQL / Claude API
    → Standardized JSON Response
```

The API follows a strict **layered architecture** — Routes define endpoints, Controllers handle HTTP concerns, and Services contain all business logic and data access.

---

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Framework** | Fastify | 5.7 |
| **Runtime** | Node.js | >= 22.0 |
| **Language** | JavaScript (ES Modules) | — |
| **Database** | Supabase (PostgreSQL) | — |
| **Auth** | Supabase Auth (JWT) | — |
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
| `POST` | `/api/v1/auth/register` | — | Register new user |
| `POST` | `/api/v1/auth/login` | — | Login |
| `GET` | `/api/v1/auth/me` | Bearer | Get current user profile |
| `GET` | `/api/v1/games` | Bearer | Get user's game history |
| `POST` | `/api/v1/games` | Bearer | Create a new game |
| `GET` | `/api/v1/games/recent` | Bearer | Global activity feed |
| `GET` | `/api/v1/games/:gameId` | Bearer | Get game details |
| `POST` | `/api/v1/games/:gameId/match-stats` | Bearer | Extract stats from FC26 screenshot |
| `DELETE` | `/api/v1/games/:gameId/match-stats` | Bearer | Remove match stats |
| `POST` | `/api/v1/games/:gameId/match-report` | Bearer | Generate AI match report |
| `POST` | `/api/v1/games/prediction` | Bearer | Generate AI match prediction |
| `GET` | `/api/v1/leaderboard` | — | Get leaderboard standings |
| `GET` | `/api/v1/players` | Bearer | Get all player profiles |
| `GET` | `/api/v1/stats/me` | Bearer | Get comprehensive user stats |
| `GET` | `/api/v1/stats/:playerId` | Bearer | Head-to-head vs specific player |
| `GET` | `/api/v1/teams` | Bearer | Get all available teams |

[Full API Documentation →](docs/features/API_ENDPOINTS.md)

---

## AI Features

Three AI features powered by **Claude Sonnet 4** make RasenBürosport unique:

### 1. FC26 Stats Extraction (Vision)

Upload a screenshot of FC26's post-match statistics screen. **Claude Vision** analyzes the image and automatically extracts all 18 stat categories — from possession and xG to yellow cards and dribbling success rate. Works with German and English game language.

### 2. Match Prediction

When players and teams are selected in the game wizard, the API generates a pre-match prediction based on career statistics, H2H records, current form, and xG efficiency. The prediction is entertaining, data-driven, and includes a score estimate.

### 3. Match Report

After a game with FC26 statistics, the API generates a German-language match commentary (3-5 sentences). It detects narratives like underdog victories, xG over-performance, dramatic comebacks, and career milestones.

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

The API uses **Supabase Auth** with JWT-based authentication:

1. Users register or login via `/api/v1/auth/register` or `/api/v1/auth/login`
2. Supabase returns a JWT access token
3. Subsequent requests include the token as `Authorization: Bearer <token>`
4. The `requireAuth` middleware verifies the token against Supabase Auth
5. The authenticated user is attached to `request.user`

The **leaderboard** and **health check** endpoints are public — all other endpoints require authentication.

[Full Auth Documentation →](docs/features/AUTHENTICATION.md)

---

## Database

### Supabase (PostgreSQL)

| Table | Purpose |
|-------|---------|
| **profiles** | User profiles (username, avatar) |
| **games** | Match records with scores, timelines, stats |
| **game_players** | Links players to games with team assignment |
| **teams** | ~400 real football clubs from 25 European leagues |

Key features: Row-Level Security (RLS), JSONB columns for match stats and score timelines, foreign key relationships.

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

---

## Security

| Layer | Implementation |
|-------|---------------|
| **Helmet** | Security headers (CSP, X-Frame-Options, etc.) |
| **CORS** | Configurable origin (default: `localhost:5173`) |
| **Rate Limiting** | 250 requests per minute per IP |
| **JWT Verification** | Supabase Auth token validation |
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

- Node.js >= 22.0
- A Supabase project (PostgreSQL + Auth)
- Anthropic API key (for AI features)

### Environment Variables

Create a `.env` file in the project root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
NODE_ENV=development
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5173
```

### Installation

```bash
npm install
```

```bash
cloud-sql-proxy --quota-project rasenbuerosport-leipzig-9d54f rasenbuerosport-leipzig-9d54f:europe-west3:rasenbuerosport-db
```

### Development

```bash
npm run dev          # Start with --watch (auto-reload)
```

The API runs on `http://localhost:3001` by default.

### Seed Demo Data

```bash
node scripts/seed.js
```

Creates 4 test users and ~40 curated games with realistic stats, timelines, and badge-triggering scenarios. Requires Supabase credentials in `.env`.

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
│   │   ├── supabase.config.js           # Supabase client singletons
│   │   ├── anthropic.config.js          # Anthropic client singleton
│   │   └── logger.config.js             # Pino logger config
│   ├── constants/
│   │   └── roles.constants.js           # User role definitions
│   └── api/
│       ├── routes/v1/                   # Auto-loaded route handlers
│       │   ├── auth/                    # Registration & login
│       │   ├── games/                   # Game CRUD & sub-routes
│       │   │   ├── recent/              # Activity feed
│       │   │   ├── prediction/          # AI match prediction
│       │   │   └── _gameId/             # Game detail & sub-resources
│       │   │       ├── match-report/    # AI match report
│       │   │       └── match-stats/     # FC26 stats extraction
│       │   ├── leaderboard/             # Rankings
│       │   ├── players/                 # Player profiles
│       │   ├── stats/                   # User stats & H2H
│       │   └── teams/                   # Team catalog
│       ├── controllers/                 # Request handlers
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
