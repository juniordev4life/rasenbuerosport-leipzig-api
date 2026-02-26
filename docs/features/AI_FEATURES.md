[← Back to Overview](../../README.md)

# AI Features

Three AI features powered by **Claude Sonnet 4** (Anthropic) set RasenBürosport apart from a simple score tracker.

---

## Architecture

```
Client Request
  → Controller
    → Service (prompt construction + context building)
      → Claude API (Anthropic SDK)
        → Response parsing
          → Database storage (reports) / Direct return (predictions)
```

All AI features use a **singleton Anthropic client** (`getAnthropicClient()`) configured via the `ANTHROPIC_API_KEY` environment variable.

**Model:** `claude-sonnet-4-20250514`
**Max Tokens:** 512 (reports & predictions), 1024 (vision extraction)

---

## 1. FC26 Stats Extraction (Vision)

### Endpoint

```
POST /api/v1/games/:gameId/match-stats
```

### How It Works

1. The user uploads an FC26 post-match statistics screenshot to **Supabase Storage**
2. The frontend sends the public image URL to the API
3. **Claude Vision** receives the image with a structured extraction prompt
4. The AI analyzes the two-column layout (home/away) and extracts all visible stats
5. The response is parsed as JSON and stored in the `match_stats` JSONB column

### Extracted Statistics (18 Categories)

| Category | Stats |
|----------|-------|
| **Ball Control** | Possession (%), Ball Recovery Time (s) |
| **Offense** | Shots, Expected Goals (xG), Shot Accuracy (%), Dribbling (%) |
| **Passing** | Passes, Pass Accuracy (%) |
| **Defense** | Duels, Duels Won, Interceptions, Saves |
| **Discipline** | Fouls, Offsides, Corners, Free Kicks, Penalties, Yellow Cards |

### Data Format

Each stat is stored as a home/away pair:

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

### Multi-Language Support

The extraction prompt includes both German and English stat labels, allowing screenshots from both game language settings to be parsed correctly:

- **German:** Ballbesitzquote, Schüsse, Erwartete Tore, Passgenauigkeit...
- **English:** Possession, Shots, Expected Goals, Pass Accuracy...

### Re-Upload Flow

Stats can be removed via `DELETE /api/v1/games/:gameId/match-stats` and re-uploaded with a new screenshot. This resets both `match_stats` and `stats_image_url` to null.

---

## 2. Match Prediction

### Endpoint

```
POST /api/v1/games/prediction
```

### How It Works

1. The frontend sends player IDs, team assignments, and team names
2. The service fetches **career statistics** for each player
3. The service fetches **H2H records** between opposing players
4. The service fetches **player profiles** (usernames)
5. All context is assembled into a structured JSON payload
6. Claude generates a 2-4 sentence German prediction with a score estimate
7. The prediction is returned directly (not persisted)

### Data Context Sent to Claude

```json
{
  "mode": "1v1",
  "players": [
    {
      "username": "MaxMustermann",
      "team_side": "home",
      "team_name": "RB Leipzig",
      "career": {
        "total_games": 50,
        "wins": 32,
        "losses": 14,
        "win_rate": 64,
        "avg_possession": 54,
        "avg_pass_accuracy": 88,
        "xg_efficiency": 1.08,
        "current_streak": { "type": "win", "count": 3 },
        "favorite_team": "RB Leipzig"
      }
    }
  ],
  "h2h": [
    {
      "player1": "MaxMustermann",
      "player2": "LisaKicker",
      "total": 31,
      "p1_wins": 19,
      "p2_wins": 10,
      "draws": 2
    }
  ]
}
```

### Prompt Guidelines

The AI considers:

- **H2H history** — Who has the upper hand historically?
- **Current form** — Win streaks = "in hot form", loss streaks = "struggling"
- **Win rate** — High = "experienced", low = "upset potential"
- **xG efficiency** — High = "clinical finisher", low = "wasteful"
- **Favorite team** — Playing with your favorite team gives a "home advantage" narrative
- **Score estimate** — Always includes a predicted final score

The prediction is entertaining but not overconfident — kicker is unpredictable!

---

## 3. Match Report Generation

### Endpoint

```
POST /api/v1/games/:gameId/match-report
```

### How It Works

1. The service loads the **full game data** (score, timeline, stats, result type)
2. For each player, it fetches **career statistics** (win rate, avg possession, xG efficiency, current streak)
3. All context is assembled into a structured JSON payload
4. Claude generates a 3-5 sentence German match commentary
5. The report is **saved to the database** (`games.match_report` column)
6. Subsequent requests return the cached report

### Data Context Sent to Claude

```json
{
  "score": "3:2",
  "result_type": "extra_time",
  "score_timeline": [
    { "home": 1, "away": 0, "period": "regular" },
    { "home": 1, "away": 1, "period": "regular" },
    { "home": 1, "away": 2, "period": "regular" },
    { "home": 2, "away": 2, "period": "extra_time" },
    { "home": 3, "away": 2, "period": "extra_time" }
  ],
  "match_stats": { "possession": { "home": 38, "away": 62 }, "..." : "..." },
  "players": [
    {
      "name": "MaxMustermann",
      "team": "home",
      "team_name": "Borussia Dortmund",
      "career": {
        "total_games": 50,
        "win_rate": 64,
        "avg_possession": 54,
        "avg_pass_accuracy": 88,
        "xg_efficiency": 1.08,
        "current_streak": { "type": "win", "count": 3 }
      }
    }
  ]
}
```

### Narrative Detection

The AI prompt instructs Claude to recognize and highlight special scenarios:

| Narrative | Trigger |
|-----------|---------|
| **Underdog Victory** | Won with significantly less possession |
| **xG Overperformance** | Scored more goals than expected (xG) |
| **xG Underperformance** | Scored fewer goals than expected |
| **Comeback** | Team was behind and turned the game around |
| **Last-Minute Drama** | Goals in extra time or penalty shootout |
| **Career Comparison** | Player performance vs. their career averages |
| **Dominant Possession** | High possession but still lost |
| **Clean Sheet** | Won without conceding |

### Caching

Reports are generated once and stored in the `match_report` TEXT column of the `games` table. The frontend checks for an existing report before triggering generation.

---

## Technical Details

### Singleton Pattern

The Anthropic client uses a singleton to avoid creating multiple SDK instances:

```javascript
let client = null;

export function getAnthropicClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return client;
}
```

### Error Handling

| Error | Code | Cause |
|-------|------|-------|
| Game not found | 404 | Invalid game ID for report generation |
| No AI response | 502 | Claude API returned empty content |
| JSON parse failure | 502 | Vision extraction returned invalid JSON |
| Supabase error | 400 | Database update failed |

### Prompt Language

All prompts instruct Claude to respond in **German** with an entertaining sports commentary style. The output is pure plain text — no Markdown formatting.

---

[← API Endpoints](API_ENDPOINTS.md) · [Back to Overview](../../README.md) · [Stats Engine →](STATS_ENGINE.md)
