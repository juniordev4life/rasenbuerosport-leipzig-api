# Deploy to Production — Runbook

Lebendes Deploy-Checklist-Dokument für den jeweils nächsten großen
Release. Jede Sektion enthält ✅-Checkboxen zum Abhaken während des
Deploys. Nach dem Deploy: die abgeschlossene Sektion entweder ins
„Release-Historie"-Footer-Archiv schieben oder mit der nächsten
Iteration überschreiben.

**Pflege-Regel:** Mit jedem Feature-PR, das eine neue Migration, ein
neues Secret, eine neue externe Abhängigkeit oder eine neue
Smoke-Test-Pflicht mitbringt, wird **dieses Dokument im selben PR
mitgepflegt**. So bleibt der Runbook immer aktuell.

---

## Aktueller Release-Stand — bereit für Prod

Auf main gemergt (oder in einer der offenen Stack-PRs), **noch nicht in Production deployed**:

- **Reporter-Personas + Talk-Show** ([API #21](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/21), [App #17](https://github.com/juniordev4life/rasenbuerosport-leipzig-app/pull/17))
- **Pass-Netzwerk-Auswertung** ([API #22](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/22) + [#23](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/23), [App #18](https://github.com/juniordev4life/rasenbuerosport-leipzig-app/pull/18))
- **ELO-System (Phase 1 + 2)** — Pure Functions + Integration ([#25](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/25), [#28](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/28))
- **Player Profile (Phase A komplett)** — 6-Achsen + Archetyp + LLM-Bio + Relationships, Backend ([API #27](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/27) + [#29](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/29) + [#30](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/30)) + Frontend ([App #19](https://github.com/juniordev4life/rasenbuerosport-leipzig-app/pull/19) + [#20](https://github.com/juniordev4life/rasenbuerosport-leipzig-app/pull/20))
- **Web-Push Notifications** — VAPID-Setup, Subscribe-Routen, neuesMatch-Trigger ([API #31](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/31), [App #23](https://github.com/juniordev4life/rasenbuerosport-leipzig-app/pull/23))
- **Lifetime Peak ELO** — neue Spalten + Career-Stats-Endpoint ([API #33](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/33)–[#36](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/36), [App #25](https://github.com/juniordev4life/rasenbuerosport-leipzig-app/pull/25))
- **ELO-Recompute-Skript** — one-off Backfill für historische Matches ([API #32](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/32))
- **Design-System Rollout, Live-Match, New-Game-Wizard, iOS-Picker-Fix** ([App #22](https://github.com/juniordev4life/rasenbuerosport-leipzig-app/pull/22)–[#26](https://github.com/juniordev4life/rasenbuerosport-leipzig-app/pull/26))

**Zusammenfassung der ausstehenden Änderungen:**

- Drei AI-Reporter-Personas (Marcel / Sophie / Frank)
- Audio-Berichte pro Match via ElevenLabs TTS
- Freitags-Talkrunde „Bürowoche" (Drehbuch + Multi-Speaker-Audio)
- Anthropic-Modell-Upgrade auf `claude-sonnet-4-6`
- Pass-Netzwerk-Auswertung mit 5-Zustands-Klassifizierung (Zentral / Rechtslastig / Linkslastig / Ausgewogen / Flügelspiel)
- Contribution-weighted ELO-System für 1v1 + 2v2 mit asymmetrischer Verteilung, Margin-of-Victory und Zeit-gewichteten Roten Karten
- Player Profile mit 6 Achsen, 8 Archetypen, Lieblings-/Angstgegner + Top-Partner — komplett inkl. Spider-Chart-UI
- Web-Push-Benachrichtigungen für „neues Match gespeichert" (PWA-fähig)
- All-Time-Peak-ELO + Career-Stats-Endpoint (`GET /v1/stats/players/:id`)
- ELO-Recompute-Skript zum Backfillen historischer Matches
- **Acht neue DB-Migrationen (010–017)**
- Neuer Cloud-Run-Env-Var-Block: VAPID-Keys, ElevenLabs-Persona-Voices
- Frontend: Audio-Player, Reporter-Label, Pass-Pills, Spider-Profil-Seite, Push-Opt-In, Live-Match-UI, neuer Game-Wizard, Design-System-Rollout

---

## 0. Vor dem Deploy — Pre-Flight Checks

- [ ] CI auf main grün (beide Repos)
- [ ] `npm test` lokal grün — API: 380+ Tests
- [ ] `npm run check:ci` lokal clean (Lint + Format)
- [ ] `gh pr list --state open` in beiden Repos leer
- [ ] Letzter Smoke-Test lokal: Match-Save (löst ELO + Profile-Cache-Invalidierung aus), Profil aufrufen, Push-Opt-In, Audio-Generierung

---

## 1. Externe Setups — ElevenLabs

Nur relevant, wenn die Audio-Features (Match-Audio + Talk-Show) zum ersten Mal in Prod aktiviert werden.

- [ ] **ElevenLabs Plan prüfen** — Library-Voices nur ab Starter ($5/Monat). Free-Tier-API kann diese Features nicht.
- [ ] **Drei Voice-IDs auswählen** im Voice Lab (https://elevenlabs.io/app/voice-lab):
  - [ ] Marcel (Klassiker) — ruhig, erfahren, deutsche Reporter-Tonlage
  - [ ] Sophie (Analytikerin) — weiblich, präzise, mittlere Tonhöhe
  - [ ] Frank (Euphoriker) — energisch, dynamisch, deutsch
  - [ ] Fallback-Voice (für Fälle, in denen eine Persona-ID nicht gesetzt ist)
- [ ] **API-Key generieren** mit Scopes `text_to_speech` (+ optional `voices_read` für lokales Debugging)
- [ ] **Aussprache-Test** im ElevenLabs-Playground gegen einen Reporter-Satz mit Spielernamen + Spielminuten. Bei Auffälligkeiten: Mapping in `src/constants/playerPronunciation.constants.js` ergänzen.

---

## 2. Externe Setups — Firebase Storage

- [ ] **Bucket-Name verifizieren** — sollte `<project-id>.firebasestorage.app` (neuere Projekte) oder `<project-id>.appspot.com` (alte Projekte) sein:
  ```bash
  gcloud storage buckets list --project=rasenbuerosport-leipzig-9d54f --format="value(name)"
  ```
- [ ] **Cloud-Run-Service-Account braucht `Storage Object Admin`** auf dem Bucket:
  ```bash
  gcloud storage buckets add-iam-policy-binding \
    gs://<bucket-name> \
    --member=serviceAccount:<cloud-run-sa>@<project>.iam.gserviceaccount.com \
    --role=roles/storage.objectAdmin
  ```
- [ ] **Storage-Folder-Konvention** zur Info:
  - `match-reports/<gameId>.mp3` — pro Match
  - `talkshow/<week_start>.mp3` — pro Woche

---

## 2b. Externe Setups — Web-Push (VAPID)

Nur einmalig nötig, wenn das Push-Feature zum ersten Mal aktiviert wird. Die Keys sind dauerhaft — einmal generiert und im Secret Manager hinterlegt, bleiben sie über alle Releases gleich.

- [ ] **VAPID-Keypair generieren** (lokal, das Tool ist im Repo schon installiert):
  ```bash
  npx web-push generate-vapid-keys
  ```
  Output:
  ```
  Public Key:  BPxa…
  Private Key: Vu7…
  ```
- [ ] **Public Key** kommt an **zwei** Stellen hin:
  - API: `PUSH_VAPID_PUBLIC_KEY` (Cloud Run Env Var, **kein** Secret nötig)
  - App: `PUBLIC_VAPID_KEY` (Firebase Hosting Build-Env, identischer Wert)
  - Beide müssen exakt gleich sein, sonst lehnen Browser die Subscription ab.
- [ ] **Private Key** ausschließlich in **Secret Manager** als `push-vapid-private-key`, Cloud Run zieht ihn per `--set-secrets`.
- [ ] **Subject** (`PUSH_VAPID_SUBJECT`) — Plain-Env, Format `mailto:marco.slusalek@redbulls.com`. Browser-Push-Services verlangen das als Kontakt-Identifier.

---

## 3. Cloud Run — Secrets & Env Vars

Alle Variablen müssen **vor dem Container-Deploy** gesetzt sein, sonst geben die Audio-/Talk-Show-Endpoints 500 zurück.

### Pflicht-Variablen (API)

- [ ] `ELEVENLABS_API_KEY` — als **Secret** in Secret Manager, Cloud Run referenziert per `--set-secrets`
- [ ] `ELEVENLABS_VOICE_ID` — Plain-Env, Fallback-Voice
- [ ] `FIREBASE_STORAGE_BUCKET` — Plain-Env, exakter Bucket-Name ohne `gs://`-Präfix
- [ ] `PUSH_VAPID_PUBLIC_KEY` — Plain-Env, Public-Hälfte aus Schritt 2b
- [ ] `PUSH_VAPID_PRIVATE_KEY` — als **Secret** in Secret Manager
- [ ] `PUSH_VAPID_SUBJECT` — Plain-Env, `mailto:<kontakt>`

### Optional / empfohlen (API)

- [ ] `ELEVENLABS_VOICE_ID_KLASSIKER` — Marcels Voice
- [ ] `ELEVENLABS_VOICE_ID_ANALYST` — Sophies Voice
- [ ] `ELEVENLABS_VOICE_ID_EUPHORIKER` — Franks Voice
- [ ] `ELEVENLABS_MODEL_ID` — Default `eleven_v3`
- [ ] `ELEVENLABS_KEEP_AUDIO_TAGS` — Default `false`. Nur `true`, wenn v3-Alpha-Zugriff für den Workspace bestätigt ist.

### App Build-Env (Firebase Hosting via GitHub Actions)

- [ ] `PUBLIC_VAPID_KEY` — identisch zu `PUSH_VAPID_PUBLIC_KEY` der API
- [ ] `PUBLIC_AUDIO_REPORT_ENABLED` — `true` schaltet Auto-TTS + Player frei. Default `false` während Audio noch in Erprobung ist.

**ELO** hat keine eigenen Env-Vars — alle Tuning-Konstanten leben in `src/constants/elo.constants.js` und werden mit dem Code deployed.

### Setting via gcloud (Beispiel)

```bash
# Secret in Secret Manager (einmalig)
echo -n "sk_xxxxxxxx" | gcloud secrets create elevenlabs-api-key \
  --replication-policy=automatic --data-file=-

# Cloud Run Service updaten
gcloud run services update rasenbuerosport-api \
  --region=europe-west3 \
  --set-secrets=ELEVENLABS_API_KEY=elevenlabs-api-key:latest,PUSH_VAPID_PRIVATE_KEY=push-vapid-private-key:latest \
  --set-env-vars=^@@^ELEVENLABS_VOICE_ID=<id>@@FIREBASE_STORAGE_BUCKET=<bucket>@@ELEVENLABS_VOICE_ID_KLASSIKER=...@@ELEVENLABS_VOICE_ID_ANALYST=...@@ELEVENLABS_VOICE_ID_EUPHORIKER=...@@PUSH_VAPID_PUBLIC_KEY=BPxa...@@PUSH_VAPID_SUBJECT=mailto:marco.slusalek@redbulls.com
```

---

## 4. DB-Migrationen (Cloud SQL Prod)

**Reihenfolge wichtig — Migrationen vor dem Code-Deploy einspielen.**
Wenn der neue Code gegen die alte DB läuft, schlagen Audio-/Talk-Show-/Pass-Network-/ELO-Endpoints fehl.

- [ ] Cloud SQL Auth Proxy starten:
  ```bash
  cloud-sql-proxy rasenbuerosport-leipzig-9d54f:europe-west3:rasenbuerosport-db --port=5433
  ```
- [ ] PROD-Verbindung verifizieren:
  ```bash
  PGPASSWORD=<prod-pw> psql -h 127.0.0.1 -p 5433 -U postgres -d rasenbuerosport -c "\d games"
  ```
- [ ] Migrationen einspielen — **in dieser Reihenfolge**:
  ```bash
  PGPASSWORD=<prod-pw> psql -h 127.0.0.1 -p 5433 -U postgres -d rasenbuerosport \
    -v ON_ERROR_STOP=1 \
    -f migrations/010_match_report_audio.sql \
    -f migrations/011_match_report_reporter.sql \
    -f migrations/012_talkshow_episodes.sql \
    -f migrations/013_pass_network.sql \
    -f migrations/014_elo_system.sql \
    -f migrations/015_profile_cache.sql \
    -f migrations/016_push_subscriptions.sql \
    -f migrations/017_peak_elo.sql \
    -f migrations/018_voice_aliases.sql
  ```
- [ ] Verifizieren:
  ```sql
  \d games                -- match_report_audio_url, match_report_audio_generated_at,
                          -- reporter_id, home_pass_network, away_pass_network,
                          -- elo_snapshot
  \d profiles             -- current_rating, matches_played, rating_updated_at,
                          -- rating_history, profile_cache,
                          -- peak_elo_value, peak_elo_at
  \d push_subscriptions   -- existiert mit user_id, endpoint, p256dh, auth, preferences
  \d talkshow_episodes    -- existiert mit week_start, week_end, script_json, audio_url
  -- voice_aliases
  SELECT column_name FROM information_schema.columns
   WHERE table_name='profiles' AND column_name='voice_aliases';
  ```
- [ ] Cloud SQL Auth Proxy stoppen (Ctrl+C)

### Migrations-Inhalt zur Erinnerung

| Migration | Was sie tut |
|---|---|
| `010_match_report_audio.sql` | `match_report_audio_url` + `match_report_audio_generated_at` auf `games` |
| `011_match_report_reporter.sql` | `reporter_id` auf `games` mit CHECK-Constraint + Partial-Index |
| `012_talkshow_episodes.sql` | Neue Tabelle `talkshow_episodes` (week_start PK, script_json, audio_url) |
| `013_pass_network.sql` | `home_pass_network` + `away_pass_network` JSONB auf `games` |
| `014_elo_system.sql` | `profiles.current_rating/matches_played/rating_updated_at/rating_history` + `games.elo_snapshot` + Index auf current_rating |
| `015_profile_cache.sql` | `profiles.profile_cache` JSONB (cached axes/archetype/bio für Player Profile) |
| `016_push_subscriptions.sql` | Neue Tabelle `push_subscriptions` (user_id FK, endpoint, p256dh, auth, preferences JSONB, failure_count) |
| `017_peak_elo.sql` | `profiles.peak_elo_value` + `peak_elo_at` für die Lifetime-Stats-Card |
| `018_voice_aliases.sql` | `profiles.voice_aliases` JSONB (Sprach-Synonyme pro Spieler für den Live-Voice-Tracker) |

Alle neun sind **additiv und nicht-destruktiv** — kein Datenverlust möglich.

---

## 4b. ELO-Backfill (einmalig, vor dem ersten Prod-Cutover)

Migration 014 setzt alle Spieler auf `current_rating = 1500` / `matches_played = 0` — sonst würde das Leaderboard nach dem Deploy mit einem Schlag aussehen, als hätte niemand je gespielt. Das Skript `scripts/recompute-all-elo.js` läuft jedes existierende Game in `played_at`-Reihenfolge erneut durch die ELO-Engine, schreibt für jedes ein `elo_snapshot` und ratched gleichzeitig `peak_elo_value`/`peak_elo_at` mit hoch.

- [ ] Cloud SQL Auth Proxy noch oder wieder auf Port 5433 laufen lassen
- [ ] Dry-Run zum Sanity-Check:
  ```bash
  DATABASE_URL=postgresql://postgres:<prod-pw>@127.0.0.1:5433/rasenbuerosport \
    node scripts/recompute-all-elo.js --dry-run
  ```
- [ ] Wenn die Output-Zusammenfassung plausibel aussieht (Anzahl Games, Anzahl Profile) — **mit Backup** scharf schalten:
  ```bash
  DATABASE_URL=... node scripts/recompute-all-elo.js --apply --backup
  ```
  Backup landet in `scripts/.elo-backup-<timestamp>.json` und enthält Profile + Game-Snapshots im Vor-Zustand.
- [ ] Smoke: drei Profile prüfen, `current_rating` ≠ 1500 und `peak_elo_value ≥ current_rating`.
- [ ] Falls etwas schief geht:
  ```bash
  DATABASE_URL=... node scripts/recompute-all-elo.js --restore=scripts/.elo-backup-<ts>.json
  ```

Das Skript braucht nur einmalig zu laufen. Spätere Releases inkrementieren ELO live über den `applyEloToMatch`-Hook in `createGame`.

---

## 5. Deploy

### API (rasenbuerosport-leipzig-api)

- [ ] `git checkout main && git pull`
- [ ] `npm run release` (oder `npm run release -- 0.2.0` für expliziten Bump — das Feature-Bündel ist groß genug für Minor-Version)
- [ ] Push setzt das Tag, GitHub Actions startet `Match Day`
- [ ] Workflow überwachen: https://github.com/juniordev4life/rasenbuerosport-leipzig-api/actions
- [ ] Cloud Run Revision: neue Revision auf 100% Traffic
- [ ] Health-Check: `curl https://<api-url>/health` → 200

### App (rasenbuerosport-leipzig-app)

- [ ] **NACH** API-Deploy: `git checkout main && git pull`
- [ ] `npm run release`
- [ ] Firebase-Hosting-Deploy via GitHub Actions
- [ ] Frontend-Smoke-Test (siehe nächste Sektion)

---

## 6. Post-Deploy Smoke Tests

### A) Match Report + Audio

- [ ] Test-Match mit vollständigen Stats in Prod öffnen
- [ ] Bericht generiert sich automatisch im Reporter-Stil
- [ ] „🎙️ Reporter: <Name>" wird unter dem Audio-Player angezeigt
- [ ] „Anhören"-Button → Loading → `<audio controls>` erscheint, abspielbar
- [ ] mp3 in Firebase Storage prüfen: `gs://<bucket>/match-reports/<gameId>.mp3` existiert
- [ ] DB-Check:
  ```sql
  SELECT id, reporter_id, match_report_audio_url IS NOT NULL AS has_audio
  FROM games WHERE id = '<test-game-id>';
  ```

### B) Talk Show — Bürowoche

- [ ] Drehbuch generieren (debug, kein DB-Spam):
  ```bash
  curl -X POST https://<api-url>/api/v1/talkshow/_preview \
    -H "Authorization: Bearer <Firebase-ID-Token>" \
    -H "Content-Type: application/json" -d '{"persist": false}'
  ```
- [ ] Skript-Output: Intro-Vorstellung dabei? Drei Sprecher mit klaren Stimmen? Reibungsmoment drin?
- [ ] Echte Episode persistieren: `-d '{}'`
- [ ] Audio rendern:
  ```bash
  curl -X POST https://<api-url>/api/v1/talkshow/audio \
    -H "Authorization: Bearer <Token>" -d '{}'
  ```
- [ ] mp3-URL im Browser → 3–5 Min Audio mit Marcel/Sophie/Frank im Dialog
- [ ] DB-Check:
  ```sql
  SELECT week_start, audio_url IS NOT NULL AS has_audio
  FROM talkshow_episodes ORDER BY week_start DESC LIMIT 1;
  ```

### C) Pass-Netzwerk-Auswertung

- [ ] Test-Match: Pässe-Screenshot in Prod hochladen
- [ ] API-Response enthält `home_pass_network` + `away_pass_network` mit:
  - `passStyle` ∈ {Zentral, Rechtslastig, Linkslastig, Ausgewogen, Flügelspiel}
  - `lateralityScore` ∈ [-100, 100]
  - `verticalityScore` ∈ [0, 100]
  - `centralPlayer` (Trikotnummer als String)
  - `topPassConnections` (max 3 Einträge)
- [ ] Im Frontend: Match-Detail zeigt 🧭 „Passverteilung"-Karte mit zwei Pills (Heim / Auswärts) und korrektem Label
- [ ] Edge-Case: Match ohne Pässe-Screenshot → keine Karte sichtbar
- [ ] DB-Check:
  ```sql
  SELECT id, home_pass_network->>'passStyle' AS home_style,
         away_pass_network->>'passStyle' AS away_style
  FROM games WHERE passes_image_url IS NOT NULL ORDER BY played_at DESC LIMIT 5;
  ```

### D) ELO-System

- [ ] Test-Match in Prod anlegen (1v1 oder 2v2) — die Response von `POST /api/v1/games` muss `elo_snapshot` enthalten:
  ```bash
  curl -X POST https://<api-url>/api/v1/games \
    -H "Authorization: Bearer <Token>" \
    -H "Content-Type: application/json" \
    -d '{ "mode": "2v2", "score_home": 3, "score_away": 1, ... }'
  ```
- [ ] Spieler-Rating abrufen:
  ```bash
  curl https://<api-url>/api/v1/players/<playerId>/rating \
    -H "Authorization: Bearer <Token>"
  ```
  Response sollte `current_rating`, `matches_played`, `rating_history` enthalten.
- [ ] Match-ELO abrufen:
  ```bash
  curl https://<api-url>/api/v1/games/<gameId>/elo \
    -H "Authorization: Bearer <Token>"
  ```
- [ ] DB-Check:
  ```sql
  -- Spieler-Ratings
  SELECT id, username, current_rating, matches_played,
         jsonb_array_length(rating_history) AS history_len
  FROM profiles ORDER BY current_rating DESC LIMIT 10;

  -- Match-Snapshot
  SELECT id, elo_snapshot->>'version' AS version,
         jsonb_array_length(elo_snapshot->'teamA') AS team_a_size
  FROM games WHERE elo_snapshot IS NOT NULL ORDER BY played_at DESC LIMIT 5;
  ```
- [ ] Plausibilitäts-Check: Bei einem 3:1-2v2-Sieg sollte der Torschütze (3 Tore) deutlich mehr ELO gewinnen als sein Mitspieler ohne Scorerpunkt. Die Summe der vier Player-Deltas sollte ungefähr 0 sein.
- [ ] Rating-History wird beim wiederholten Match anhängend gefüllt (max 30 Einträge).

### E) Player Profile

- [ ] `GET /api/v1/players/<player-id>/profile` mit Auth-Token → 200, Payload enthält:
  - `profileState` (`frischling` / `im_aufbau` / `etabliert`)
  - `axes` mit allen sechs Werten (finisher, playmaker, clutch, consistency, discipline, winner) zwischen 0–100 (null bei Frischling)
  - `archetype` mit `key`, `label`, `color`, `icon`
  - `bio` mit `adjective` + `bio` (nur bei `etabliert`, ab 15 Spielen)
  - `relationships` mit `lieblingsgegner`, `angstgegner`, `topPartner` (alle können `null` sein bei < 3 gemeinsamen Spielen)
  - `topBadges` (max 3 Einträge, nach Tier sortiert) — Form `{ type, emoji, … }` aus `getUserStats`
  - `player.matchCount` muss zu `recentForm.length` und Spielhistorie passen — Quelle ist live-COUNT aus `game_players`, nicht `profiles.matches_played`
- [ ] Frischling-Pfad: Spieler mit < 5 Matches liefert `profileState = "frischling"`, `axes = null`, keine Bio. Eingangs-Hinweis erscheint im Frontend.
- [ ] Im-Aufbau-Pfad: Spieler mit 5–14 Matches liefert `profileState = "im_aufbau"`, Achsen vorhanden, Archetyp ohne LLM-Bio.
- [ ] Cache-Invalidation: nach Speichern eines neuen Matches darf der nächste Profile-Request **nicht** den alten Cache liefern — neue `matchCount` im Payload prüfen.
- [ ] DB-Check:
  ```sql
  SELECT id, username,
         profile_cache->>'matchCountAtComputation' AS cached_matches,
         (SELECT COUNT(*) FROM game_players WHERE player_id = profiles.id) AS actual
  FROM profiles WHERE profile_cache IS NOT NULL LIMIT 5;
  ```
- [ ] LLM-Timeout-Fallback: bei langsamem Anthropic-Call wird der zuletzt gecachte Bio-Block ausgespielt; Endpoint blockiert nie länger als 5 s.

### F) Web-Push Notifications

- [ ] In der App auf einem **HTTPS**-Browser (Service Worker laufen nur über https oder localhost) einloggen
- [ ] Settings-Tile „Push aktivieren" sichtbar → Klick → Browser-Permission-Prompt → Accept
- [ ] DB-Check:
  ```sql
  SELECT user_id, LEFT(endpoint, 60) AS endpoint_preview, preferences
  FROM push_subscriptions ORDER BY created_at DESC LIMIT 5;
  ```
- [ ] **Trigger-Test**: ein neues Match mit anderem User-Account speichern → der Account mit aktiver Subscription bekommt eine „Neues Match gespeichert"-Notification auf Desktop/Mobile
- [ ] **Failure-Handling**: Subscription manuell auf Browser-Seite löschen (DevTools → Application → Service Workers → Unregister), nochmal Match anlegen → API setzt `failure_count` hoch und nach 5 Fehlversuchen wird der Eintrag aus `push_subscriptions` entfernt
- [ ] **iOS Safari (PWA)**: nur, falls Marco/Kollegen iOS benutzen — Web-Push funktioniert dort nur als installierte PWA (Home-Screen-Icon). Im normalen Mobile-Safari greift es nicht.

### G) Peak ELO + Career Stats

- [ ] `GET /api/v1/stats/players/<playerId>` mit Auth → 200, Payload enthält u.a.:
  - `goals`, `assists`, `hattricks`, `longest_win_streak`
  - `peak_elo` mit `value` + `at` (Datum des Peak-Spiels)
  - `peak_elo.value` muss ≥ `current_rating` sein (sonst Daten-Inkonsistenz)
- [ ] Nach dem Backfill stimmt für 3 Stichprobenspieler `peak_elo_value` mit dem höchsten Eintrag aus deren Rating-Verlauf überein
- [ ] Frontend-Spielerprofil zeigt unter „Karriere" einen Peak-ELO-Wert ≠ 1500 (für jeden, der schon gespielt hat)
- [ ] DB-Check:
  ```sql
  SELECT id, username, current_rating, peak_elo_value, peak_elo_at
  FROM profiles WHERE matches_played > 0 ORDER BY peak_elo_value DESC LIMIT 10;
  ```

---

## 7. Cloud Scheduler — Wöchentliche Talk-Show (zukünftig, Phase 4)

Stand dieses Releases: noch **nicht** implementiert. Die Talk-Show
wird manuell via `/talkshow/_preview` + `/talkshow/audio` getriggert.

Sobald Phase 4 implementiert ist:

- [ ] Cloud Scheduler Job:
  ```bash
  gcloud scheduler jobs create http talkshow-friday \
    --location=europe-west3 \
    --schedule="0 17 * * FRI" \
    --time-zone="Europe/Berlin" \
    --uri="https://<api-url>/api/v1/talkshow/generate" \
    --http-method=POST \
    --headers="X-Scheduler-Secret=<WRAPPED_TRIGGER_SECRET>"
  ```
- [ ] Erste manuelle Ausführung in Cloud Console → Cloud Scheduler → Run now

---

## 8. Rollback-Plan

1. **API-Rollback**:
   - Cloud Run Console → Revisions → vorherige Revision auf 100% Traffic
2. **App-Rollback**:
   - Firebase Hosting → Release-History → vorherige Version rollouten
3. **DB-Rollback** — nicht nötig:
   - Migrationen 010–017 sind additiv. Selbst wenn der API-Container auf der alten Version läuft, sind die neuen Spalten/Tabellen einfach unbenutzt.
4. **Audio-Cache leeren** (bei Bedarf):
   ```bash
   PGPASSWORD=<prod-pw> psql -h 127.0.0.1 -p 5433 -U postgres -d rasenbuerosport \
     -c "UPDATE games SET match_report_audio_url = NULL;"
   gsutil rm gs://<bucket>/match-reports/*.mp3
   gsutil rm gs://<bucket>/talkshow/*.mp3
   ```
5. **ELO-Backfill rückgängig machen** (wenn das Recompute-Skript Mist produziert hat):
   ```bash
   DATABASE_URL=postgresql://postgres:<prod-pw>@127.0.0.1:5433/rasenbuerosport \
     node scripts/recompute-all-elo.js --restore=scripts/.elo-backup-<ts>.json
   ```
6. **ELO komplett zurücksetzen** (letzter Notnagel, wenn das Backup verloren ist):
   ```sql
   UPDATE profiles SET current_rating = 1500, matches_played = 0,
                       rating_updated_at = NULL, rating_history = '[]'::jsonb,
                       peak_elo_value = 1500, peak_elo_at = NULL,
                       profile_cache = NULL;
   UPDATE games SET elo_snapshot = NULL;
   ```
7. **Push-Subscriptions leeren** (bei kaputtem Sender oder Key-Wechsel):
   ```sql
   TRUNCATE push_subscriptions;
   ```
   User müssen sich danach einmal neu opt-in'en.

---

## 9. Bekannte Stolpersteine

- **Bucket-Berechtigungen** — `Storage Object Admin` ist Pflicht. `Storage Object Viewer` reicht nicht (Upload schlägt fehl).
- **ElevenLabs Free-Tier** — Library-Voices schlagen mit 402 fehl. Mindestens Starter-Plan nötig.
- **Audio-Tag-Vorlesung** — wenn ElevenLabs `[nachdenklich]` als Text vorliest, ist `ELEVENLABS_KEEP_AUDIO_TAGS` auf `true` gesetzt obwohl v3 nicht freigeschaltet ist. Auf `false` zurückstellen.
- **Wortzahl-Range im Drehbuch** — wenn Talk-Show-Skripte zu kurz/lang ausfallen, ist meistens das Datenbundle dünn (frische Woche ohne genug Spiele). Erst nach ~5 Spielen pro Woche stabil.
- **Reporter-Verteilung** — über mehrere Wochen sollten alle drei Personas vorkommen. Wenn ein Reporter konstant unterrepräsentiert ist: `selectReporter.utils.js` → `REPORTER_WEIGHTS_BY_DRAMA` rebalancieren.
- **Player-Name-Aussprache** — wenn Spielernamen schlecht klingen: `src/constants/playerPronunciation.constants.js` ergänzen, nicht im Prompt fummeln.
- **Pass-Netzwerk-Extraktion zu unzuverlässig** — wenn der Vision-Call die Netzwerke nicht erkennt, schreibt `normalisePassNetwork` `null` in die DB statt fehlerhafter Werte. Falls das systematisch passiert: Prompt-Block in `PASSES_EXTRACTION_PROMPT` schärfen oder einen Beispiel-Screenshot im Prompt ergänzen.
- **ELO-Tuning** — wenn sich die Deltas zu wenig oder zu stark bewegen, an `src/constants/elo.constants.js` justieren (`kFactor`, `goalWeight`, `assistWeight`, `redCardPenalty`, `shareMin/Max`). Bei jedem Tuning-Change `ELO_ALGORITHM_VERSION` bumpen, damit alte Match-Snapshots als „v1.0"-Stand erkennbar bleiben.
- **ELO bei unvollständigen Profilen** — fehlt für einen Spieler im `profiles.id`-Lookup ein Eintrag, fällt das System auf `startingRating: 1500` und `matchesPlayed: 0` zurück. Das ist kein Crash, aber prüfbar in `eloMatchInput.services.js`.

---

## 10. Nach dem Deploy

- [ ] Release-Notes intern teilen (Slack / Team)
- [ ] Monatlich: ElevenLabs Character-Verbrauch prüfen — bei Starter-Plan 30k/Monat
- [ ] Update dieses Dokument: abgeschlossene Sektionen ins „Release-Historie"-Footer schieben, „Aktueller Release-Stand" mit dem nächsten Feature überschreiben

---

## 11. Release-Historie

| Datum | Release | API-Tag | App-Tag | Notes |
|---|---|---|---|---|
| _yyyy-mm-dd_ | _Reporter-Personas + Pass-Network + ELO_ | _v0.2.0_ | _v0.x.0_ | _Beim ersten Prod-Deploy hier eintragen_ |

---

## 12. Pflege-Erinnerung für Claude und Marco

Dieses Dokument ist ein **lebendes Runbook**. Mit jedem Feature-PR, der
eine der folgenden Eigenschaften mitbringt, wird DEPLOY_PROD.md
**im selben PR** mitgepflegt:

- Neue DB-Migration → in Sektion 4 ergänzen
- Neue Env-Var / Secret → in Sektion 3 ergänzen
- Neue externe Abhängigkeit (3rd-party-API, neuer Bucket etc.) → in Sektion 1 oder 2 ergänzen
- Neuer Endpoint, der gesmoke-testet werden muss → in Sektion 6 ergänzen
- Bekannter Stolperstein nach einem Fehlversuch → in Sektion 9 ergänzen
- Erfolgreicher Prod-Deploy → in Sektion 11 (Release-Historie) eintragen

So bleibt der Runbook immer aktuell und der nächste Deploy ist eine
strukturierte Checkliste statt ein „was war das nochmal?".
