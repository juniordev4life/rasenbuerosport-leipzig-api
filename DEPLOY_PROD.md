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
- **ELO-System (Phase 1 + 2)** — Pure Functions + Integration ([#25](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/25), aktueller PR)

**Zusammenfassung der ausstehenden Änderungen:**

- Drei AI-Reporter-Personas (Marcel / Sophie / Frank)
- Audio-Berichte pro Match via ElevenLabs TTS
- Freitags-Talkrunde „Bürowoche" (Drehbuch + Multi-Speaker-Audio)
- Anthropic-Modell-Upgrade auf `claude-sonnet-4-6`
- Pass-Netzwerk-Auswertung mit 5-Zustands-Klassifizierung (Zentral / Rechtslastig / Linkslastig / Ausgewogen / Flügelspiel)
- Contribution-weighted ELO-System für 1v1 + 2v2 mit asymmetrischer Verteilung, Margin-of-Victory und Zeit-gewichteten Roten Karten
- **Fünf neue DB-Migrationen (010–014)**
- Sechs neue / erweiterte API-Endpoints
- Frontend: Audio-Player, Reporter-Label, Pass-Verteilungs-Pills

---

## 0. Vor dem Deploy — Pre-Flight Checks

- [ ] CI auf main grün (beide Repos)
- [ ] `npm test` lokal grün — API: 313 Tests
- [ ] `npm run check:ci` lokal clean (Lint + Format)
- [ ] Letzter Smoke-Test in lokaler Dev-Umgebung erfolgreich (Match-Report mit Audio + Talk-Show + Pass-Network-Pills + ELO-Berechnung beim Match-Save)

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

## 3. Cloud Run — Secrets & Env Vars

Alle Variablen müssen **vor dem Container-Deploy** gesetzt sein, sonst geben die Audio-/Talk-Show-Endpoints 500 zurück.

### Pflicht-Variablen

- [ ] `ELEVENLABS_API_KEY` — als **Secret** in Secret Manager, Cloud Run referenziert per `--set-secrets`
- [ ] `ELEVENLABS_VOICE_ID` — Plain-Env, Fallback-Voice
- [ ] `FIREBASE_STORAGE_BUCKET` — Plain-Env, exakter Bucket-Name ohne `gs://`-Präfix

### Optional / empfohlen

- [ ] `ELEVENLABS_VOICE_ID_KLASSIKER` — Marcels Voice
- [ ] `ELEVENLABS_VOICE_ID_ANALYST` — Sophies Voice
- [ ] `ELEVENLABS_VOICE_ID_EUPHORIKER` — Franks Voice
- [ ] `ELEVENLABS_MODEL_ID` — Default `eleven_v3`
- [ ] `ELEVENLABS_KEEP_AUDIO_TAGS` — Default `false`. Nur `true`, wenn v3-Alpha-Zugriff für den Workspace bestätigt ist.

**ELO** hat keine eigenen Env-Vars — alle Tuning-Konstanten leben in `src/constants/elo.constants.js` und werden mit dem Code deployed.

### Setting via gcloud (Beispiel)

```bash
# Secret in Secret Manager (einmalig)
echo -n "sk_xxxxxxxx" | gcloud secrets create elevenlabs-api-key \
  --replication-policy=automatic --data-file=-

# Cloud Run Service updaten
gcloud run services update rasenbuerosport-api \
  --region=europe-west3 \
  --set-secrets=ELEVENLABS_API_KEY=elevenlabs-api-key:latest \
  --set-env-vars=^@@^ELEVENLABS_VOICE_ID=<id>@@FIREBASE_STORAGE_BUCKET=<bucket>@@ELEVENLABS_VOICE_ID_KLASSIKER=...@@ELEVENLABS_VOICE_ID_ANALYST=...@@ELEVENLABS_VOICE_ID_EUPHORIKER=...
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
    -f migrations/014_elo_system.sql
  ```
- [ ] Verifizieren:
  ```sql
  \d games                -- match_report_audio_url, match_report_audio_generated_at,
                          -- reporter_id, home_pass_network, away_pass_network,
                          -- elo_snapshot
  \d profiles             -- current_rating, matches_played, rating_updated_at,
                          -- rating_history
  \d talkshow_episodes    -- existiert mit week_start, week_end, script_json, audio_url
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

Alle fünf sind **additiv und nicht-destruktiv** — kein Datenverlust möglich.

**ELO-Backfill (optional):** Die Migration setzt alle Spieler auf `current_rating = 1500` und `matches_played = 0`. Wenn historische Matches retroaktiv durchs ELO-System laufen sollen:

```bash
# Stand: noch nicht implementiert; ein Backfill-Skript würde alle Games
# in played_at-Reihenfolge durchlaufen und für jedes recomputeEloForGame
# rufen. Wenn das benötigt wird, eigenes Ticket.
```

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
   - Migrationen 010–014 sind additiv. Selbst wenn der API-Container auf der alten Version läuft, sind die neuen Spalten/Tabellen einfach unbenutzt.
4. **Audio-Cache leeren** (bei Bedarf):
   ```bash
   PGPASSWORD=<prod-pw> psql -h 127.0.0.1 -p 5433 -U postgres -d rasenbuerosport \
     -c "UPDATE games SET match_report_audio_url = NULL;"
   gsutil rm gs://<bucket>/match-reports/*.mp3
   gsutil rm gs://<bucket>/talkshow/*.mp3
   ```
5. **ELO komplett zurücksetzen** (Notnagel, falls die Persistenz-Logik buggy ist):
   ```sql
   UPDATE profiles SET current_rating = 1500, matches_played = 0,
                       rating_updated_at = NULL, rating_history = '[]'::jsonb;
   UPDATE games SET elo_snapshot = NULL;
   ```

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
