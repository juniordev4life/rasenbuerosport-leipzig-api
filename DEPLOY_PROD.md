# Deploy to Production — Runbook

Sammelpunkt für alle Deploy-Schritte des nächsten großen Releases. Jede
Sektion enthält ✅-Checkboxen zum Abhaken während des eigentlichen
Deploys. Dieses Dokument wird mit jedem größeren Release-PR
aktualisiert — die Sektionen ohne Häkchen sind die offenen Pflichten
für das nächste Mal.

---

## Aktueller Release-Stand

**Branch / PR:** `feat/reporter-personas-and-talkshow` ([API #21](https://github.com/juniordev4life/rasenbuerosport-leipzig-api/pull/21), [App #17](https://github.com/juniordev4life/rasenbuerosport-leipzig-app/pull/17))

**Was rauskommt:**

- Reporter-Personas (Marcel / Sophie / Frank) für Match-Reports und neue Talk-Show "Bürowoche"
- Audio-Pipeline via ElevenLabs (per Match + wöchentliche Talk-Runde)
- Anthropic-Modell auf `claude-sonnet-4-6` für alle AI-Services
- Drei neue DB-Migrationen + drei neue API-Endpoints
- Frontend-Audio-Player + Reporter-Label im Match-Detail

---

## 0. Vor dem Deploy — Pre-Flight Checks

- [ ] Beide PRs (#21 API, #17 App) sind reviewed und approved
- [ ] CI auf beiden Branches grün (Pre-Match Checks)
- [ ] `npm test` lokal grün (API: 216 Tests)
- [ ] `npm run check:ci` lokal clean (Lint + Format)
- [ ] Letztes Smoke-Test in lokaler Dev-Umgebung erfolgreich (Match-Report + Talk-Show generieren)

---

## 1. Externe Setups — ElevenLabs

- [ ] **ElevenLabs Plan prüfen** — Library-Voices nur ab Starter ($5/Monat). Free-Tier-API kann diese Features nicht.
- [ ] **Drei Voice-IDs auswählen** im ElevenLabs Voice Lab (https://elevenlabs.io/app/voice-lab):
  - [ ] Marcel (Klassiker) — ruhig, erfahren, deutsche Reporter-Tonlage
  - [ ] Sophie (Analytikerin) — weiblich, präzise, mittlere Tonhöhe
  - [ ] Frank (Euphoriker) — energisch, dynamisch, deutsch
  - [ ] Fallback-Voice (für Fälle, in denen eine Persona-ID nicht gesetzt ist)
- [ ] **API-Key generieren** mit den benötigten Scopes:
  - `text_to_speech`
  - Optional: `voices_read` für lokales Debugging
- [ ] **Aussprache-Test** im ElevenLabs-Playground: Voice-IDs gegen einen typischen Reporter-Satz mit Spielernamen + Spielminuten testen
  - Falls Aussprache von Spielernamen schief klingt: Mapping in `src/constants/playerPronunciation.constants.js` ergänzen

---

## 2. Externe Setups — Firebase Storage

- [ ] **Bucket-Name verifizieren** — sollte `<project-id>.firebasestorage.app` sein (neue Firebase-Projekte) ODER `<project-id>.appspot.com` (alte Projekte). Verifizieren via Firebase Console → Storage:
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
- [ ] **Storage-Folder-Konvention** dokumentieren (nicht zwingend, gut zu wissen):
  - `match-reports/<gameId>.mp3` — pro Match
  - `talkshow/<week_start>.mp3` — pro Woche

---

## 3. Cloud Run — Secrets & Env Vars

Alle neuen Env-Vars müssen vor dem Deploy in Cloud Run gesetzt sein,
sonst läuft der API-Container hoch, aber die Audio-Endpoints geben 500
beim ersten Aufruf zurück.

### Pflicht-Variablen

- [ ] `ELEVENLABS_API_KEY` — als **Secret** in Secret Manager, Cloud Run referenziert per `--set-secrets`
- [ ] `ELEVENLABS_VOICE_ID` — als Plain-Env, Fallback-Voice
- [ ] `FIREBASE_STORAGE_BUCKET` — als Plain-Env, exakter Bucket-Name ohne `gs://`-Präfix

### Optional / empfohlen

- [ ] `ELEVENLABS_VOICE_ID_KLASSIKER` — Marcels Voice
- [ ] `ELEVENLABS_VOICE_ID_ANALYST` — Sophies Voice
- [ ] `ELEVENLABS_VOICE_ID_EUPHORIKER` — Franks Voice
- [ ] `ELEVENLABS_MODEL_ID` — Default `eleven_v3`, andere möglich
- [ ] `ELEVENLABS_KEEP_AUDIO_TAGS` — Default `false`. Auf `true` nur, wenn v3-Alpha-Zugriff für den Workspace bestätigt ist.

### Setting via gcloud (Beispiel)

```bash
# Secrets in Secret Manager anlegen (einmalig)
echo -n "sk_xxxxxxxx" | gcloud secrets create elevenlabs-api-key \
  --replication-policy=automatic --data-file=-

# Cloud Run Service updaten
gcloud run services update rasenbuerosport-api \
  --region=europe-west3 \
  --set-secrets=ELEVENLABS_API_KEY=elevenlabs-api-key:latest \
  --set-env-vars=ELEVENLABS_VOICE_ID=<voice-id>,FIREBASE_STORAGE_BUCKET=<bucket-name>,ELEVENLABS_VOICE_ID_KLASSIKER=...,ELEVENLABS_VOICE_ID_ANALYST=...,ELEVENLABS_VOICE_ID_EUPHORIKER=...
```

---

## 4. DB-Migrationen (Cloud SQL Prod)

**WICHTIG: Migrationen vor dem Code-Deploy einspielen.** Wenn der neue
Code gegen die alte DB läuft, schlagen alle Talk-Show- und
Audio-Endpoints fehl.

- [ ] Cloud SQL Auth Proxy starten lokal:
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
    -f migrations/012_talkshow_episodes.sql
  ```
- [ ] Verifizieren:
  ```sql
  \d games               -- prüfen: match_report_audio_url, match_report_audio_generated_at, reporter_id
  \d talkshow_episodes   -- prüfen: Tabelle existiert mit allen Spalten
  ```
- [ ] Cloud SQL Auth Proxy stoppen (Ctrl+C)

### Migrations-Inhalt zur Erinnerung

| Migration | Was sie tut |
|---|---|
| `010_match_report_audio.sql` | Spalten `match_report_audio_url` + `match_report_audio_generated_at` auf `games` |
| `011_match_report_reporter.sql` | Spalte `reporter_id` auf `games` mit CHECK-Constraint + Partial-Index |
| `012_talkshow_episodes.sql` | Neue Tabelle `talkshow_episodes` (week_start PK, script_json, audio_url) |

Alle drei sind additiv und nicht-destruktiv — kein Datenverlust möglich.

---

## 5. Deploy

### API (rasenbuerosport-leipzig-api)

- [ ] `git checkout main && git pull`
- [ ] `npm run release` (oder `npm run release -- 0.2.0` für expliziten Major-Bump — das Feature ist groß genug für Minor-Version-Bump)
- [ ] Push setzt das Tag, Cloud Build / GitHub Actions startet automatisch den `Match Day`-Workflow
- [ ] **Workflow überwachen**: https://github.com/juniordev4life/rasenbuerosport-leipzig-api/actions
- [ ] Cloud Run Revision prüfen: neue Revision sollte auf 100% Traffic stehen
- [ ] Health-Check: `curl https://<api-url>/health` sollte 200 zurückgeben

### App (rasenbuerosport-leipzig-app)

- [ ] **NACH** dem API-Deploy: `git checkout main && git pull`
- [ ] `npm run release` (Minor-Bump, da neue UI-Feature)
- [ ] Firebase-Hosting-Deploy läuft via GitHub Actions
- [ ] **Frontend-Smoke-Test**: Match-Detail öffnen, „Anhören"-Button erscheint

---

## 6. Post-Deploy Smoke Tests

### Match Report + Audio (per Match)

- [ ] **Test-Match** mit vollständigen Stats in Prod öffnen
- [ ] Bericht wird automatisch generiert — sollte im neuen Reporter-Stil sein (eine der drei Personas)
- [ ] „🎙️ Reporter: <Name>" wird unter dem Audio-Player angezeigt
- [ ] „Anhören"-Button klicken → Loading → `<audio controls>` erscheint, mp3 ist abspielbar
- [ ] mp3 in Firebase Storage prüfen: `gs://<bucket>/match-reports/<gameId>.mp3` existiert
- [ ] DB-Check:
  ```sql
  SELECT id, reporter_id, match_report_audio_url IS NOT NULL AS has_audio
  FROM games WHERE id = '<test-game-id>';
  ```

### Talk Show (wöchentlich)

- [ ] **Debug-Endpoint** mit `persist:false` aufrufen, um Skript zu sehen ohne DB-Spam:
  ```bash
  curl -X POST https://<api-url>/api/v1/talkshow/_preview \
    -H "Authorization: Bearer <Firebase-ID-Token>" \
    -H "Content-Type: application/json" \
    -d '{"persist": false}'
  ```
- [ ] Skript-Output prüfen: Intro-Vorstellung dabei? Drei Sprecher mit klaren Stimmen? Reibungsmoment drin?
- [ ] Echte Episode für die aktuelle Woche **persistieren** (default `persist:true`):
  ```bash
  curl -X POST https://<api-url>/api/v1/talkshow/_preview \
    -H "Authorization: Bearer <Token>" -d '{}'
  ```
- [ ] **Audio rendern**:
  ```bash
  curl -X POST https://<api-url>/api/v1/talkshow/audio \
    -H "Authorization: Bearer <Token>" -d '{}'
  ```
- [ ] mp3-URL im Browser öffnen → 3–5 Min Audio mit Marcel/Sophie/Frank im Dialog
- [ ] DB-Check:
  ```sql
  SELECT week_start, audio_url IS NOT NULL AS has_audio
  FROM talkshow_episodes ORDER BY week_start DESC LIMIT 1;
  ```

---

## 7. Cloud Scheduler — Wöchentliche Talk-Show (manueller Schritt, falls noch nicht im Code)

Stand dieses Releases: der Scheduler-Endpoint für die Talk-Show ist
**noch nicht** implementiert (Phase 4). Solange er noch fehlt, wird
die Talk-Show manuell via `/talkshow/_preview` getriggert.

Wenn Phase 4 implementiert ist, kommt hier:

- [ ] Cloud Scheduler Job anlegen:
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

Falls etwas schiefläuft:

1. **API-Rollback**:
   - In Cloud Run Console: Revisions → vorherige Revision auf 100% Traffic
   - Oder: vorheriges Image-Tag pushen und Match Day re-triggern
2. **App-Rollback**:
   - Firebase Hosting → Release-History → vorherige Version rollouten
3. **DB-Rollback** — nicht nötig:
   - Migrationen 010–012 sind additiv. Selbst wenn der API-Container auf der alten Version läuft, sind die neuen Spalten / Tabellen einfach unbenutzt.
4. **Audio-Cache leeren** (bei Bedarf):
   ```bash
   # Cloud SQL Proxy auf
   PGPASSWORD=<prod-pw> psql -h 127.0.0.1 -p 5433 -U postgres -d rasenbuerosport \
     -c "UPDATE games SET match_report_audio_url = NULL;"
   gsutil rm gs://<bucket>/match-reports/*.mp3
   ```

---

## 9. Bekannte Stolpersteine

- **Bucket-Berechtigungen** — `Storage Object Admin` ist Pflicht. `Storage Object Viewer` reicht nicht (Upload schlägt fehl).
- **ElevenLabs Free-Tier** — Library-Voices schlagen mit 402 fehl. Mindestens Starter-Plan nötig.
- **Audio-Tag-Vorlesung** — wenn ElevenLabs `[nachdenklich]` als Text vorliest statt zu interpretieren, ist `ELEVENLABS_KEEP_AUDIO_TAGS` auf `true` gesetzt obwohl v3 nicht freigeschaltet ist. Auf `false` zurückstellen.
- **Wortzahl-Range im Drehbuch** — wenn Talk-Show-Skripte zu kurz/lang ausfallen, ist meistens das Datenbundle dünn (frische Woche ohne genug Spiele). Erst nach ~5 Spielen pro Woche stabil.
- **Reporter-Verteilung** — über mehrere Wochen sollten alle drei Personas vorkommen. Wenn ein Reporter konstant unterrepräsentiert ist: `selectReporter.utils.js` → `REPORTER_WEIGHTS_BY_DRAMA` rebalancieren.
- **Player-Name-Aussprache** — wenn Spielernamen schlecht klingen: `src/constants/playerPronunciation.constants.js` ergänzen, nicht im Prompt fummeln.

---

## 10. Nach dem Deploy

- [ ] Release-Notes intern teilen (Slack / Team)
- [ ] Monatlich: ElevenLabs Character-Verbrauch prüfen — bei Starter-Plan 30k/Monat
- [ ] Bei nächstem Reporter-Persona-Tuning: dieses Dokument updaten, falls neue Env-Vars dazukommen
