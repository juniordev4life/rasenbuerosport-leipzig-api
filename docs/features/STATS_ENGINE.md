[← Back to Overview](../../README.md)

# Stats Engine & Badges

The stats engine is the analytical core of RasenBürosport. It computes comprehensive player statistics, career averages from FC26 data, and evaluates 15 unlockable badges — all calculated on-the-fly from game data.

---

## Endpoint

```
GET /api/v1/stats/me
```

Returns the full stats payload for the authenticated user. No caching — always computed fresh from the database.

---

## Core Statistics

### Overall Record

| Field | Type | Description |
|-------|------|-------------|
| `total_games` | integer | Total games played |
| `wins` | integer | Total wins |
| `losses` | integer | Total losses |
| `draws` | integer | Total draws |
| `win_rate` | integer | Win percentage (0-100) |

### Mode Split

Separate win/loss records for each game mode:

```json
{
  "bilanz_1v1": { "wins": 21, "losses": 7 },
  "bilanz_2v2": { "wins": 11, "losses": 7 }
}
```

### Player Relationships

| Field | Logic |
|-------|-------|
| `favorite_opponent` | Player with most games against the user |
| `best_teammate` | Teammate with highest win rate together (min. 2 games, fallback: most played) |
| `favorite_team` | Most frequently selected team name |

### Current Streak

Tracks the active win or loss streak. **Draws do not break streaks** — they are skipped. A streak must be at least 2 to be reported.

```json
{
  "current_streak": { "type": "win", "count": 5 }
}
```

Algorithm:
1. Games are sorted by `played_at` descending (most recent first)
2. Leading draws are skipped
3. The first non-draw result sets the streak type
4. Consecutive results of the same type increment the counter
5. Draws in the middle are ignored
6. A different result type stops the streak

---

## Career Match Stats

Aggregated averages from all games that have uploaded FC26 statistics. Only appears when at least one game has `match_stats`.

```json
{
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
  }
}
```

### Calculation Details

| Metric | Formula |
|--------|---------|
| `avg_possession` | Sum of user's possession / games with stats |
| `avg_pass_accuracy` | Sum of user's pass accuracy / games with stats |
| `avg_dribbling` | Sum of user's dribbling % / games with stats |
| `avg_shot_accuracy` | Sum of user's shot accuracy / games with stats |
| `avg_xg_per_game` | Total xG / games with xG data |
| `total_xg` | Sum of all xG values |
| `xg_efficiency` | Total goals scored / total xG |
| `avg_duels_won_rate` | Total duels won / total duels * 100 |

> **xG Efficiency** > 1.0 means the player scores more goals than statistically expected. < 1.0 means they underperform their chances.

---

## 15 Unlockable Badges

Badges are evaluated on every stats request. Each badge has a `type`, `emoji`, and `unlocked` boolean.

### Stats-Based Badges (require FC26 data)

| # | Badge | Emoji | Condition | Min Games |
|---|-------|-------|-----------|-----------|
| 1 | **tiki_taka** | 🎯 | Avg pass accuracy > 85% | 3 |
| 2 | **ball_magnet** | 🧲 | Avg possession > 55% | 3 |
| 3 | **konter_king** | ⚡ | Won any game with < 40% possession | 1 |
| 4 | **xg_killer** | 🔫 | Career xG efficiency > 1.3 | 5 |
| 5 | **duell_monster** | 💪 | Avg duel win rate > 60% | 3 |
| 6 | **perfektionist** | 💎 | 100% pass accuracy in any single game | 1 |
| 9 | **david_vs_goliath** | 🏹 | Won any game with < 30% possession | 1 |

### Score-Based Badges

| # | Badge | Emoji | Condition |
|---|-------|-------|-----------|
| 7 | **schuetzenfest** | 🎉 | Scored 5+ goals in a single game |
| 8 | **clean_sheet** | 🛡️ | Won without conceding (score > 0, conceded = 0) |
| 14 | **torjaeger_50** | ⚽ | 50+ career goals across all games |

### Milestone Badges

| # | Badge | Emoji | Condition |
|---|-------|-------|-----------|
| 11 | **debuetant** | 👶 | Played at least 1 game |
| 12 | **stammspieler** | ⭐ | Played 25+ games |
| 13 | **klublegende** | 👑 | Played 100+ games |

### Streak & Discipline Badges

| # | Badge | Emoji | Condition |
|---|-------|-------|-----------|
| 10 | **fair_play** | 🤝 | 10+ games without any yellow card |
| 15 | **seriensieger** | 🔥 | Had a 5+ win streak at any point in history |

### Fair Play Badge Logic

The fair play badge counts games where the user's team received 0 yellow cards. Games without `match_stats` are counted as "no yellow card" games (benefit of the doubt).

### Seriensieger (Streak Master) Logic

Unlike the current streak calculation, this badge checks the **entire game history** chronologically:

1. Games are sorted ascending (oldest first)
2. Wins increment the counter, losses reset it
3. Draws do not break the streak
4. If the counter ever reaches 5, the badge is unlocked

---

## Head-to-Head

### Endpoint

```
GET /api/v1/stats/:playerId
```

Compares the authenticated user against a specific opponent across all shared games where they were on opposite teams.

### Response

```json
{
  "opponent": {
    "username": "LisaKicker",
    "avatar_url": "https://..."
  },
  "total_games": 31,
  "user_wins": 19,
  "opponent_wins": 10,
  "draws": 2,
  "recent_games": []
}
```

### Calculation

1. Find all `game_players` entries for both users
2. Identify games where both participated on **different teams**
3. For each shared game, determine the winner based on score and team assignment
4. Return the overall record and the 5 most recent shared games with full details

---

## Leaderboard Stats

The leaderboard (`GET /api/v1/leaderboard`) uses a separate calculation with its own badge system:

### Points System

| Result | Points |
|--------|--------|
| Win | 3 |
| Draw | 1 |
| Loss | 0 |

### Leaderboard Badges

These are **active badges** (currently ongoing streaks), different from profile badges:

| Badge | Condition |
|-------|-----------|
| **wall** | 2+ consecutive wins with clean sheet |
| **scorer** | 2+ consecutive games with 3+ goals |

### Date Filtering

The leaderboard supports `from` and `to` query parameters (ISO date format) to filter by time period:
- **Last 7 days**
- **Last 30 days**
- **Last 90 days**
- **All time** (no filter)

---

## Implementation Details

### Data Flow

```
game_players (user's games)
  → games (with match_stats JSONB)
    → Per-game analysis (win/loss, goals, stats)
      → Aggregation (career averages)
        → Badge evaluation
          → Final response
```

### Performance

All stats are computed on-the-fly from the database. No caching layer exists — this keeps the data always fresh but means each request queries all of a user's games. For the expected scale (office kicker league, <100 players, <1000 games), this is performant.

### Edge Cases

- **No games:** Returns empty stats with all zeros and empty badges
- **No FC26 data:** `career_match_stats` is `null`, stats-based badges are locked
- **No teammates:** `best_teammate` falls back to most played teammate regardless of win rate
- **No opponents:** `favorite_opponent` is `null`
- **All draws:** Current streak is `null` (min 2 non-draw results required)

---

[← AI Features](AI_FEATURES.md) · [Back to Overview](../../README.md) · [Authentication →](AUTHENTICATION.md)
