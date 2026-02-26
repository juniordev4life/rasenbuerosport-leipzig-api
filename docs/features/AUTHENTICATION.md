[← Back to Overview](../../README.md)

# Authentication & Security

RasenBürosport uses **Supabase Auth** for user management and JWT-based authentication on all protected endpoints.

---

## Authentication Flow

```
1. User registers or logs in
   POST /api/v1/auth/register  or  POST /api/v1/auth/login
       ↓
2. Supabase Auth returns JWT tokens
   { access_token, refresh_token }
       ↓
3. Frontend stores the access token
       ↓
4. Subsequent requests include the token
   Authorization: Bearer eyJ...
       ↓
5. requireAuth middleware verifies the token
   supabase.auth.getUser(token)
       ↓
6. Authenticated user attached to request.user
```

---

## Middleware: requireAuth

The `requireAuth` middleware is a Fastify `preHandler` applied to all protected routes.

### What It Does

1. Extracts the `Bearer` token from the `Authorization` header
2. Verifies the JWT against Supabase Auth via `supabase.auth.getUser(token)`
3. On success: attaches the full user object to `request.user`
4. On failure: returns `401 Unauthorized`

### Error Responses

**Missing token:**

```json
{
  "code": 401,
  "title": "Unauthorized",
  "message": "Missing or invalid authorization header",
  "data": null,
  "error": ["No bearer token provided"]
}
```

**Invalid/expired token:**

```json
{
  "code": 401,
  "title": "Unauthorized",
  "message": "Invalid or expired token",
  "data": null,
  "error": ["Token verification failed"]
}
```

---

## Public vs Protected Endpoints

| Endpoint | Auth Required |
|----------|--------------|
| `GET /health` | No |
| `GET /api/v1/leaderboard` | No |
| `POST /api/v1/auth/register` | No |
| `POST /api/v1/auth/login` | No |
| **All other endpoints** | **Yes** |

---

## User Registration

### Endpoint

```
POST /api/v1/auth/register
```

### Process

1. Check if the `username` is already taken (query `profiles` table)
2. Create the user via `supabase.auth.admin.createUser()` with the service role client
3. Supabase Auth creates the user in `auth.users`
4. A trigger (or the service) creates a profile in the `profiles` table
5. The user is automatically signed in and receives JWT tokens

### Invite-Only Mode

The app uses Supabase's invite-only mode — new users can only be registered through the API or the admin invite script (`scripts/invite.js`). Self-registration through Supabase's UI is disabled.

---

## User Login

### Endpoint

```
POST /api/v1/auth/login
```

### Process

1. Authenticate via `supabase.auth.signInWithPassword()`
2. Supabase verifies credentials and returns a session with JWT tokens
3. The `access_token` is used for subsequent API requests
4. The `refresh_token` can be used to obtain new access tokens

---

## Supabase Client Configuration

The backend uses two Supabase client instances (singletons):

| Client | Purpose | Key |
|--------|---------|-----|
| `getSupabase()` | Public operations, token verification | `SUPABASE_ANON_KEY` |
| `getSupabaseAdmin()` | Admin operations, data access | `SUPABASE_SERVICE_ROLE_KEY` |

The **anon client** is used for JWT verification (`supabase.auth.getUser()`).
The **admin client** bypasses Row-Level Security (RLS) for service-level data operations.

---

## Security Layers

### Helmet

`@fastify/helmet` adds security headers to all responses:

- Content Security Policy (CSP)
- X-Frame-Options
- X-Content-Type-Options
- Referrer Policy
- Strict Transport Security (HSTS)

### CORS

`@fastify/cors` controls cross-origin access:

```javascript
{
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true
}
```

The `CORS_ORIGIN` environment variable should match the frontend's URL.

### Rate Limiting

`@fastify/rate-limit` prevents abuse:

```javascript
{
  max: 250,
  timeWindow: "1 minute"
}
```

250 requests per minute per IP address. Exceeding the limit returns `429 Too Many Requests`.

### JSON Schema Validation

Fastify's built-in JSON Schema validation ensures all input data matches expected formats before it reaches the controller. Schemas are defined in `src/api/schemas/` and applied to routes via the `schema` option.

---

## Roles

The backend defines a simple role system:

```javascript
export const ROLES = {
  USER: "user",
  ADMIN: "admin",
};
```

Currently, all authenticated users have the same permissions. The role system is in place for future expansion (admin panel, moderation, etc.).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (admin) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `CORS_ORIGIN` | No | Frontend URL (default: `http://localhost:5173`) |
| `PORT` | No | Server port (default: `3001`) |
| `HOST` | No | Server host (default: `0.0.0.0`) |
| `NODE_ENV` | No | `development` or `production` |

> **Security:** Never commit `.env` files. The `.env` file is listed in `.gitignore`.

---

[← Stats Engine](STATS_ENGINE.md) · [Back to Overview](../../README.md) · [Database →](DATABASE.md)
