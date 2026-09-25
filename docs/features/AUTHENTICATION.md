[← Back to Overview](../../README.md)

# Authentication & Security

RasenBürosport uses **Firebase Authentication** with Google Sign-In. The API never issues credentials. It verifies the Firebase ID token the app sends and admits only **verified `@redbulls.com` accounts**.

---

## Authentication Flow

```
1. The app signs in with Google (Firebase Auth, signInWithPopup)
       ↓
2. Every request carries the Firebase ID token
   Authorization: Bearer <id-token>
       ↓
3. requireAuth verifies it with the Firebase Admin SDK
   getFirebaseAuth().verifyIdToken(token)
       ↓
4. requireAuth checks the account:
   email_verified === true and the address ends in @redbulls.com
       ↓
5. request.user = { id: <uid>, email }
       ↓
6. GET /api/v1/auth/me → the profile, or needsSetup: true on first sign-in
   (the app then creates the profile with PATCH /api/v1/auth/profile)
```

---

## Middleware: requireAuth

`src/api/middlewares/auth.middlewares.js`. A Fastify `preHandler` on every protected route. The feedback route runs it as `onRequest` instead; see [Rate Limiting](#rate-limiting).

1. Extracts the `Bearer` token from the `Authorization` header
2. Verifies the token with the Firebase Admin SDK
3. Admits the account only if `email_verified` is true and the address ends in `@` + `ALLOWED_EMAIL_DOMAIN`. The constant lives in `src/constants/auth.constants.js` and is currently `redbulls.com`. The `@` in the check rules out lookalikes such as `evilredbulls.com`, `redbulls.com.evil.com` and subdomains
4. Attaches `{ id, email }` to `request.user`. It does not load the profile. Admin-only routes add `requireAdmin`, which reads `profiles.role`

Because the gate sits in `requireAuth`, it covers every Bearer route. That includes `PATCH /api/v1/auth/profile`, so an account outside the domain cannot create a profile.

### Error Responses

All rejections are generic. The reason (Firebase error code, rejected email domain) is logged server-side only.

**Missing token (401):**

```json
{
  "code": 401,
  "title": "Unauthorized",
  "message": "Missing or invalid authorization header",
  "data": null,
  "error": ["No bearer token provided"]
}
```

**Invalid or expired token (401):**

```json
{
  "code": 401,
  "title": "Unauthorized",
  "message": "Invalid or expired token",
  "data": null,
  "error": ["Token verification failed"]
}
```

**Account outside the gate (403).** The body is identical for a foreign domain, an unverified address, and a token without an email:

```json
{
  "code": 403,
  "title": "Forbidden",
  "message": "User not authorized",
  "data": null,
  "error": ["Access denied"]
}
```

The app matches on the exact message `User not authorized` and signs the user out. It never deletes the Firebase account: after a wrong rejection, the next sign-in would get a new uid and lose the link to the profile and match history. Keep the message stable.

---

## Public vs Protected Endpoints

| Endpoint | Auth |
|----------|------|
| `GET /health` | None |
| `GET /api/v1/leaderboard`, `GET /api/v1/seasons*` | None |
| `POST /api/v1/wrapped/generate`, `POST /api/v1/talkshow/generate` | Scheduler secret (`X-Trigger-Secret`) |
| Office recording agent routes (see the README's agent endpoints) | Agent secret (`X-Agent-Secret`) |
| `DELETE /api/v1/games/:gameId` | Bearer + `requireAdmin` |
| **All other endpoints** | Bearer (Firebase ID token + account gate) |

---

## Profile Endpoint Rules

`PATCH /api/v1/auth/profile` creates the profile on first use (upsert) and updates it afterwards. Omitted or `null` fields keep their current value.

| Field | Rule |
|-------|------|
| `username` | 2–30 characters |
| `avatar_url` | `null`, or an absolute https URL of an allowed kind (see below). Otherwise 400 |
| `voice_aliases` | Up to 10 entries of 1–30 characters. An empty array clears them |

Allowed avatar URLs are checked by `isAllowedAvatarUrl` in `src/api/services/auth.services.js`:

- the user's own upload in the project's Storage bucket: `https://firebasestorage.googleapis.com/v0/b/<FIREBASE_STORAGE_BUCKET>/o/avatars%2F<uid>%2F…`
- a Google account photo: `https://lh3.googleusercontent.com/…`

Anything else gets 400 `Invalid avatar URL`. Without `FIREBASE_STORAGE_BUCKET`, no Storage URL is accepted. The allow-list exists because every viewer's browser loads the avatar: an arbitrary URL would let one user make everyone's browser request an image from a host of their choosing.

---

## Security Layers

### Helmet

`@fastify/helmet` adds security headers to all responses: Content Security Policy, X-Frame-Options, X-Content-Type-Options, Referrer Policy, Strict Transport Security.

### CORS

`@fastify/cors` allows the origins in `CORS_ORIGIN` (comma-separated for several, default `http://localhost:5173`), with credentials enabled. Keep it in sync with the deployed app URL.

### Rate Limiting

`@fastify/rate-limit` allows 250 requests per minute per client IP. Exceeding the limit returns `429 Too Many Requests`.

The client IP comes from `trustProxy: 1` in `src/server.js`. Fastify trusts exactly one proxy hop, Cloud Run's Google Front End, and takes the address it appends to `X-Forwarded-For`. Do not switch to `true`: that trusts every hop and takes the left-most entry, which the client writes itself, so the limit could be bypassed with a new fake IP per request. If a load balancer, Cloud Armor or a Hosting rewrite is ever put in front of the service, add one hop per extra proxy.

Things to know:

- **Office network:** colleagues behind the same office NAT share one bucket.
- **Per instance:** counters live in memory per Cloud Run instance.
- **Feedback:** `POST /api/v1/feedback` has its own limit instead of the global one: 5 submissions per 10 minutes **per user**. The route runs `requireAuth` as an `onRequest` hook, so the user is known when the limiter builds its key, and anonymous requests are rejected before their body (up to 10 MB) is read.

### JSON Schema Validation

Fastify validates params, query strings and bodies against the schemas in `src/api/schemas/` before a request reaches the controller.

---

## Roles

```javascript
export const ROLES = {
  USER: "user",
  ADMIN: "admin",
};
```

Roles are stored on `profiles.role`. `requireAdmin` (after `requireAuth`) guards admin-only routes, e.g. `DELETE /api/v1/games/:gameId`.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_PROJECT_ID` | Yes | Firebase project the Admin SDK validates ID tokens against |
| `FIREBASE_STORAGE_BUCKET` | Yes | Storage bucket for audio reports; also bounds the avatar allow-list. Must match the app's `PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | Local fallback to a service-account JSON; otherwise Application Default Credentials |
| `CORS_ORIGIN` | No | Allowed app origin(s), comma-separated (default: `http://localhost:5173`) |
| `WRAPPED_TRIGGER_SECRET` | For scheduler routes | Shared secret for Cloud Scheduler |
| `AGENT_SECRET` | For agent routes | Shared secret for the office recording agent |

> **Security:** Never commit `.env` files. The `.env` file is listed in `.gitignore`.

---

[← Stats Engine](STATS_ENGINE.md) · [Back to Overview](../../README.md) · [Database →](DATABASE.md)
