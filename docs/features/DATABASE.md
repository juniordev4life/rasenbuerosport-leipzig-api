[← Back to Overview](../../README.md)

# Database Schema

RasenBürosport uses **Supabase** (PostgreSQL) as its database with Row-Level Security (RLS) and Supabase Auth for user management.

---

## Entity Relationship

```
auth.users (Supabase Auth)
    │
    ├── 1:1 ── profiles
    │              │
    │              └── 1:N ── game_players
    │                             │
    │                             └── N:1 ── games
    │
    └── (created_by) ── games

teams (standalone catalog)
```

---

## Tables

### profiles

User profiles linked to Supabase Auth users.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PK, FK → auth.users.id | User ID from Supabase Auth |
| `username` | text | UNIQUE, NOT NULL | Display name |
| `avatar_url` | text | nullable | Profile image URL (Supabase Storage) |
| `created_at` | timestamptz | DEFAULT now() | Registration date |

---

### games

Core match records with optional AI-generated content and FC26 statistics.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PK, DEFAULT gen_random_uuid() | Game ID |
| `mode` | text | NOT NULL | `1v1` or `2v2` |
| `score_home` | integer | NOT NULL | Home team final score |
| `score_away` | integer | NOT NULL | Away team final score |
| `played_at` | timestamptz | DEFAULT now() | When the game was played |
| `created_by` | uuid | FK → auth.users.id | Who recorded the game |
| `result_type` | text | DEFAULT 'regular' | `regular`, `extra_time`, or `penalty` |
| `score_timeline` | jsonb | nullable | Goal progression array |
| `match_stats` | jsonb | nullable | FC26 extracted statistics |
| `stats_image_url` | text | nullable | URL to uploaded FC26 screenshot |
| `match_report` | text | nullable | AI-generated match commentary |
| `created_at` | timestamptz | DEFAULT now() | Record creation date |

#### score_timeline Format

Array of score snapshots showing goal progression:

```json
[
  { "home": 1, "away": 0, "period": "regular" },
  { "home": 1, "away": 1, "period": "regular" },
  { "home": 2, "away": 1, "period": "regular" },
  { "home": 2, "away": 2, "period": "extra_time" },
  { "home": 3, "away": 2, "period": "extra_time" }
]
```

#### match_stats Format

JSONB object with 18 stat categories, each as home/away pair:

```json
{
  "possession": { "home": 62, "away": 38 },
  "shots": { "home": 14, "away": 7 },
  "xg": { "home": 2.3, "away": 0.8 },
  "passes": { "home": 412, "away": 287 },
  "pass_accuracy": { "home": 88, "away": 76 },
  "duels": { "home": 52, "away": 52 },
  "duels_won": { "home": 31, "away": 21 },
  "interceptions": { "home": 8, "away": 12 },
  "saves": { "home": 3, "away": 6 },
  "fouls": { "home": 9, "away": 14 },
  "offsides": { "home": 2, "away": 1 },
  "corners": { "home": 6, "away": 2 },
  "free_kicks": { "home": 14, "away": 9 },
  "penalties": { "home": 0, "away": 0 },
  "yellow_cards": { "home": 1, "away": 3 },
  "dribbling": { "home": 72, "away": 55 },
  "shot_accuracy": { "home": 64, "away": 43 },
  "ball_recovery_time": { "home": 8, "away": 12 }
}
```

---

### game_players

Pivot table linking players to games with team assignment.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PK, DEFAULT gen_random_uuid() | Record ID |
| `game_id` | uuid | FK → games.id, NOT NULL | Game reference |
| `player_id` | uuid | FK → auth.users.id, NOT NULL | Player reference |
| `team` | text | NOT NULL | `home` or `away` |
| `team_name` | text | nullable | Selected football club name |
| `rating` | integer | nullable | Optional player rating |

**Cardinality:**
- 1v1 games: 2 entries (1 home, 1 away)
- 2v2 games: 4 entries (2 home, 2 away)

---

### teams

Catalog of 500+ real football clubs available for team selection.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PK | Team ID |
| `name` | text | NOT NULL | Full club name |
| `short_name` | text | nullable | Abbreviated name |
| `logo_url` | text | nullable | Club crest image URL |

Teams span major leagues: Bundesliga, Premier League, La Liga, Serie A, Ligue 1, and more.

---

## Supabase Storage

Used for storing user-uploaded images:

| Bucket | Purpose | Access |
|--------|---------|--------|
| **avatars** | Profile pictures | Public read |
| **screenshots** | FC26 stat screenshots | Public read |

Images are uploaded from the frontend via Supabase's storage API. The resulting public URL is stored in the database (`avatar_url` or `stats_image_url`).

---

## Row-Level Security (RLS)

Supabase RLS policies control data access at the database level:

- Users can read their own profile
- Users can update their own profile (username, avatar)
- Games are readable by participants
- Game creation requires authentication
- The service role key (used by the backend) bypasses RLS for administrative operations

---

## Queries & Access Patterns

### Common Query Patterns

| Operation | Tables Joined | Example |
|-----------|---------------|---------|
| User's game history | games + game_players + profiles | Paginated, sorted by played_at DESC |
| Game detail | games + game_players + profiles | Single game with all players |
| User stats | game_players + games + profiles | All games for aggregation |
| Leaderboard | games + game_players + profiles | All games with date filter |
| H2H comparison | game_players + games | Common games on opposite teams |

### Supabase Query Style

The API uses Supabase's PostgREST query builder with nested selects:

```javascript
const { data, error } = await supabase
  .from("games")
  .select(`
    *,
    game_players (
      player_id,
      team,
      team_name,
      profiles:player_id (username, avatar_url)
    )
  `)
  .eq("id", gameId)
  .single();
```

This generates a single SQL query with JOINs, avoiding N+1 problems for related data.

---

## Seed Script

The seed script (`scripts/seed.js`) populates the database with demo data:

### Test Users

| Email | Username | Password |
|-------|----------|----------|
| max@test.de | MaxMustermann | Test1234! |
| lisa@test.de | LisaKicker | Test1234! |
| tom@test.de | TomTorjaeger | Test1234! |
| anna@test.de | AnnaAbwehr | Test1234! |

### Generated Data

- **~40 curated games** spread across February 2026
- **Realistic score timelines** with goal progression
- **FC26 match stats** on ~70% of games
- **Result types:** ~80% regular, ~12% extra time, ~8% penalty
- **Mode mix:** ~65% 1v1, ~35% 2v2
- **Badge triggers:** MaxMustermann is designed to unlock 13-14 of 15 badges

### Running the Seed Script

```bash
node scripts/seed.js
```

Requires a `.env` file with Supabase credentials. The script uses `supabase.auth.admin.createUser()` to create test accounts.

---

## Manual Migrations

The `match_report` column was added after initial deployment:

```sql
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS match_report TEXT;
```

All other schema changes are managed through Supabase's dashboard or migration tools.

---

[← Authentication](AUTHENTICATION.md) · [Back to Overview](../../README.md)
