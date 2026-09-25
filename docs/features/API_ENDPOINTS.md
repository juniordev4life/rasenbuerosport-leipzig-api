[← Back to Overview](../../README.md)

# API Endpoints

Complete reference for all REST endpoints of the RasenBürosport Leipzig API.

---

## Base URL

```
http://localhost:3001/api/v1
```

All endpoints are prefixed with `/api/v1` via Fastify's autoload plugin.

---

## Authentication

Most endpoints require a Firebase ID token in the `Authorization` header. The app gets the token from Firebase Auth (Google Sign-In):

```
Authorization: Bearer <firebase-id-token>
```

Only **verified `@redbulls.com` accounts** are admitted. Every other account gets 403 `User not authorized` on every Bearer route. An invalid or expired token gets a generic 401. Details and the exact error bodies are in [Authentication](AUTHENTICATION.md).

Public endpoints (no auth required): `/health`, `/api/v1/leaderboard`, `/api/v1/seasons*`

Sign-up and login happen in the app via Firebase. The API has no register or login endpoints.

---

## Auth Endpoints

### `GET /auth/me`

Get the authenticated user's profile.

**Auth:** Bearer token required

**Response (200), existing profile:**

```json
{
  "code": 200,
  "title": "Success",
  "message": "Profile retrieved",
  "data": {
    "id": "<firebase-uid>",
    "username": "MaxMustermann",
    "avatar_url": "https://...",
    "role": "user",
    "needsSetup": false
  },
  "error": []
}
```

**Response (200), first sign-in (no profile yet):** `data` is `{ "id", "email", "username": null, "avatar_url": null, "needsSetup": true }`. The app then shows its setup page and creates the profile with `PATCH /auth/profile`.

**Response (403):** `User not authorized` for any account outside the gate. The app signs the user out on exactly this message.

---

### `PATCH /auth/profile`

Create the current user's profile on first use, or update it. Omitted or `null` fields keep their current value.

**Auth:** Bearer token required

**Request Body:**

```json
{
  "username": "MaxMustermann",
  "avatar_url": "https://firebasestorage.googleapis.com/v0/b/<bucket>/o/avatars%2F<uid>%2Favatar.png?alt=media&token=...",
  "voice_aliases": ["Maxi"]
}
```

| Field | Rule |
|-------|------|
| `username` | 2–30 characters |
| `avatar_url` | `null`, the caller's own upload in the project bucket (`…/o/avatars%2F<uid>%2F…`), or a Google account photo (`https://lh3.googleusercontent.com/…`) |
| `voice_aliases` | Up to 10 entries of 1–30 characters. An empty array clears them |

**Response (200):** The stored profile row.

**Response (400):** Schema violation (e.g. a non-https `avatar_url`), or `Invalid avatar URL` for an https URL outside the allow-list.

---

## Game Endpoints

### `POST /games`

Create a new game.

**Auth:** Bearer token required

**Request Body:**

```json
{
  "mode": "1v1",
  "score_home": 3,
  "score_away": 1,
  "players": [
    { "id": "player-uuid-1", "team": "home", "team_name": "FC Bayern München" },
    { "id": "player-uuid-2", "team": "away", "team_name": "Borussia Dortmund" }
  ],
  "score_timeline": [
    { "home": 1, "away": 0, "period": "regular" },
    { "home": 2, "away": 0, "period": "regular" },
    { "home": 2, "away": 1, "period": "regular" },
    { "home": 3, "away": 1, "period": "regular" }
  ],
  "result_type": "regular",
  "played_at": "2026-02-20T14:30:00Z"
}
```

**Supported modes:** `1v1` (2 players) or `2v2` (4 players)

**Result types:** `regular`, `extra_time`, `penalty`

**Score timeline:** Array of score snapshots showing goal progression. Each entry includes `home`, `away` scores and the `period` ("regular", "extra_time", "penalty").

**Response (201):** Returns the created game record.

---

### `GET /games`

Get the authenticated user's game history.

**Auth:** Bearer token required

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 10 | Number of games to return |
| `offset` | integer | 0 | Pagination offset |

**Response (200):** Array of games with nested player profiles, team names, and scores.

---

### `GET /games/recent`

Get global recent games (activity feed).

**Auth:** Bearer token required

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 10 | Number of games to return |

**Response (200):** Array of recent games across all players.

---

### `GET /games/:gameId`

Get detailed view of a single game.

**Auth:** Bearer token required

**Response (200):** Full game record including:
- Score and result type
- Score timeline (goal progression)
- Match stats (if uploaded)
- Match report (if generated)
- All players with profiles and team assignments

---

### `POST /games/:gameId/match-stats`

Upload an FC26 screenshot for AI stats extraction.

**Auth:** Bearer token required

**Request Body:**

```json
{
  "imageUrl": "https://your-supabase-project.supabase.co/storage/v1/object/public/screenshots/image.jpg"
}
```

The image URL must be publicly accessible. Claude Vision analyzes the screenshot and extracts 18 stat categories automatically.

**Response (200):** Updated game record with extracted `match_stats` JSON.

[More about FC26 Stats Extraction →](AI_FEATURES.md#1-fc26-stats-extraction-vision)

---

### `DELETE /games/:gameId/match-stats`

Remove match stats from a game (for re-upload).

**Auth:** Bearer token required

**Response (200):** Updated game record with `match_stats` and `stats_image_url` set to null.

---

### `POST /games/:gameId/match-report`

Generate an AI match report for a game.

**Auth:** Bearer token required

**Response (200):**

```json
{
  "data": "Was für eine verrückte Aufholjagd von Borussia Dortmund! Atletico Madrid dominierte..."
}
```

The report is generated by Claude and saved to the game record. Subsequent requests return the cached report.

[More about AI Match Reports →](AI_FEATURES.md#3-match-report-generation)

---

### `POST /games/prediction`

Generate an AI match prediction before a game starts.

**Auth:** Bearer token required

**Request Body:**

```json
{
  "mode": "1v1",
  "players": [
    { "id": "player-uuid-1", "team": "home", "team_name": "RB Leipzig" },
    { "id": "player-uuid-2", "team": "away", "team_name": "FC Bayern München" }
  ]
}
```

**Response (200):**

```json
{
  "data": "MaxMustermann mit seiner beeindruckenden 64% Winrate trifft auf LisaKicker..."
}
```

Predictions are generated on-the-fly and not persisted.

[More about AI Match Predictions →](AI_FEATURES.md#2-match-prediction)

---

## Leaderboard Endpoint

### `GET /leaderboard`

Get player rankings based on points (3 per win, 1 per draw).

**Auth:** Not required (public endpoint)

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 10 | Number of players to return |
| `from` | string | — | Start date filter (ISO format) |
| `to` | string | — | End date filter (ISO format) |

**Response (200):**

```json
{
  "data": [
    {
      "player_id": "uuid",
      "username": "MaxMustermann",
      "avatar_url": "https://...",
      "points": 48,
      "wins": 15,
      "draws": 3,
      "losses": 5,
      "games": 23,
      "last_played_at": "2026-02-25T14:00:00Z",
      "current_streak": { "type": "win", "count": 3 },
      "badges": [
        { "type": "wall", "count": 2 },
        { "type": "scorer", "count": 3 }
      ]
    }
  ]
}
```

**Leaderboard Badges:**

| Badge | Condition |
|-------|-----------|
| `wall` | 2+ consecutive clean sheet wins |
| `scorer` | 2+ consecutive games with 3+ goals |

---

## Player Endpoints

### `GET /players`

Get all registered player profiles.

**Auth:** Bearer token required

**Response (200):** Array of `{ id, username, avatar_url }`.

---

## Stats Endpoints

### `GET /stats/me`

Get comprehensive statistics for the authenticated user.

**Auth:** Bearer token required

**Response (200):**

```json
{
  "data": {
    "total_games": 50,
    "wins": 32,
    "losses": 14,
    "draws": 4,
    "win_rate": 64,
    "bilanz_1v1": { "wins": 21, "losses": 7 },
    "bilanz_2v2": { "wins": 11, "losses": 7 },
    "favorite_opponent": { "username": "LisaKicker", "avatar_url": "...", "games": 20 },
    "best_teammate": { "username": "AnnaAbwehr", "avatar_url": "...", "games": 8 },
    "favorite_team": { "name": "RB Leipzig", "games": 15 },
    "current_streak": { "type": "win", "count": 3 },
    "last_played_at": "2026-02-25T14:00:00Z",
    "career_match_stats": {
      "games_with_stats": 28,
      "avg_possession": 54,
      "avg_pass_accuracy": 88,
      "avg_dribbling": 67,
      "avg_shot_accuracy": 72,
      "avg_xg_per_game": 1.8,
      "total_xg": 50.4,
      "xg_efficiency": 1.08,
      "avg_duels_won_rate": 59
    },
    "badges": [
      { "type": "tiki_taka", "emoji": "🎯", "unlocked": true },
      { "type": "klublegende", "emoji": "👑", "unlocked": false }
    ]
  }
}
```

[Full Stats Documentation →](STATS_ENGINE.md)

---

### `GET /stats/:playerId`

Get head-to-head statistics between the authenticated user and a specific player.

**Auth:** Bearer token required

**Response (200):**

```json
{
  "data": {
    "opponent": { "username": "LisaKicker", "avatar_url": "..." },
    "total_games": 31,
    "user_wins": 19,
    "opponent_wins": 10,
    "draws": 2,
    "recent_games": []
  }
}
```

Returns the overall H2H record and the 5 most recent shared games.

---

## Teams Endpoint

### `GET /teams`

Get all available teams.

**Auth:** Bearer token required

**Response (200):** Array of `{ id, name, short_name, logo_url }`.

The database includes 500+ real football clubs from Bundesliga, Premier League, La Liga, Serie A, Ligue 1, and more.

---

## Error Responses

All errors follow the standard response format:

```json
{
  "code": 401,
  "title": "Unauthorized",
  "message": "Invalid or expired token",
  "data": null,
  "error": ["Token verification failed"]
}
```

| Code | Description |
|------|-------------|
| `400` | Bad Request — Invalid input or validation error |
| `401` | Unauthorized — Missing or invalid JWT token |
| `404` | Not Found — Resource does not exist |
| `429` | Too Many Requests — Rate limit exceeded |
| `502` | Bad Gateway — AI model did not respond |

---

[← Back to Overview](../../README.md) · [AI Features →](AI_FEATURES.md)
