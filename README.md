# OTP Shield

**Real-time SMS phone verification with Twilio Verify.** A production-shaped Node.js/Express
backend and an accessible, responsive UI that sends genuine six-digit SMS codes and verifies
them server-side.

> **No simulations.** If Twilio Verify is not configured, the API answers `503` and the UI
> disables sending. OTP Shield never generates a fake code, never accepts a client-declared
> "verified" flag, and never shows a success message without an `approved` response from
> Twilio. Real SMS delivery requires Twilio credentials, an active account, and any
> applicable billing.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Features](#features)
- [Quick start](#quick-start)
- [Twilio Verify setup](#twilio-verify-setup)
- [Configuration](#configuration)
- [API](#api)
- [Security model](#security-model)
- [Testing](#testing)
- [Deployment](#deployment)
- [Scaling & persistence](#scaling--persistence)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [License](#license)

---

## What it does

1. The user picks a country and enters a phone number.
2. The server validates and normalises it to **E.164**, then asks **Twilio Verify** to send an
   SMS. Twilio generates the code; OTP Shield never sees or stores it.
3. The user enters the six digits. The server checks them **with Twilio** — the browser cannot
   approve itself.
4. Only an `approved` answer marks the session verified. The verified state lives server-side and
   is keyed by a signed, http-only cookie. The profile endpoint (`GET /api/profile`) returns data
   for verified sessions and `403 verification_required` for everyone else.

## Architecture

```
┌──────────────────────────┐        ┌──────────────────────────────────────────┐
│  Browser (vanilla ES)    │        │  Express server (Node 20+)               │
│  • UI, timers, toasts    │ HTTPS  │  • Helmet CSP, origin guard, rate limits │
│  • no secrets, no OTP    │───────▶│  • Zod validation → E.164 (libphonenumber)│
│  • signed http-only      │        │  • VerificationService (cooldowns, caps)  │
│    session cookie only   │◀───────│  • Session store (TTL, attempt counters)  │
└──────────────────────────┘        └───────────────┬──────────────────────────┘
                                                    │ Twilio REST API (server-side only)
                                                    ▼
                                     ┌──────────────────────────────────┐
                                     │  Twilio Verify v2                │
                                     │  • generates + sends the code    │
                                     │  • stores TTL, rate limits       │
                                     │  • approves or rejects the check │
                                     └──────────────────────────────────┘
```

**Trust boundaries:** the browser is untrusted. It supplies a phone number, then a code. Every
decision — validation, cooldown, attempt counting, expiry, approval — happens on the server or at
Twilio. API credentials never leave the server environment.

## Features

**Verification**
- Real SMS through **Twilio Verify v2** (codes generated and validated by Twilio).
- Strict **E.164** normalisation with `libphonenumber-js` (245 countries, trunk prefixes, `+`
  handling, country/prefix mismatch detection).
- **Six-digit OTP** entry with paste, autofill, auto-advance, arrow/backspace keys and screen
  reader announcements.
- **Resend cooldown** (default 30 s) with live countdown and a server-authoritative resend
  endpoint that ignores any client-supplied number.
- **Expiry timer** (default 10 min) with a progress bar; expired codes are rejected locally and
  cancelled at Twilio so they can never be replayed.
- **Attempt cap** (default 5, matching Twilio) with remaining-attempt dots and lockout messaging.

**Security**
- Helmet with a **strict CSP** (`default-src 'self'`, no inline scripts/styles, no third-party
  origins), HSTS in production, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, COOP/CORP.
- **Signed, http-only, SameSite=Lax** session cookie; opaque server-side session ids.
- **CSRF defence**: origin allow-list for state-changing requests + `application/json`-only
  requests (a cross-site HTML form cannot send that content type).
- **Layered abuse prevention**: per-IP rate limits (global, send, verify), per-number rolling send
  caps, per-number resend cooldown, per-verification attempt caps and a keyed lock that stops
  parallel requests from racing past a cooldown.
- **Zod** schema validation, 8 KB body limit, safe error envelope, no stack traces or provider
  messages in responses.
- **Log hygiene**: phone numbers are masked, tokens/secrets redacted, provider payloads reduced to
  error codes.
- Optional destination **country allow-list**, Twilio API-key auth, and a timeout on every
  provider call.

**Product & UI**
- Responsive layout for mobile and desktop, dark and light themes, reduced-motion support.
- Clear **loading states** (spinners, `aria-busy`), success and error **toasts**, inline field
  errors with `aria-invalid`, and explicit **network-error** messaging.
- Step indicator, restore-after-refresh (an in-flight or verified session is re-hydrated from the
  server), and a profile page that **visibly distinguishes verified from unverified** users.
- Keyboard-accessible country combobox (search, arrow keys, Enter/Escape) and skip link.

## Quick start

```bash
git clone <your-repo> && cd new-pj-mark
npm install
cp .env.example .env
```

Edit `.env`:

```env
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=VA...
SESSION_SECRET=<openssl rand -hex 32>
APP_ORIGIN=http://localhost:3000
NODE_ENV=development
```

```bash
npm run check:twilio      # validates credentials + Verify Service (no SMS sent)
npm run dev               # http://localhost:3000
```

Run the tests:

```bash
npm test
```

Requirements: **Node.js 20.11+** (22 LTS recommended), npm 10+.

## Twilio Verify setup

1. **Create an account** at <https://www.twilio.com/try-twilio> and complete verification.
2. **Create a Verify Service**: Console → *Verify* → *Services* → *Create Service*.
   - Friendly name: `OTP Shield`
   - **Code length: 6 digits** (the UI and validation expect six digits)
   - **Lookup enabled**: recommended, so landlines are rejected before an SMS is attempted.
3. Copy the **Service SID** (`VA…`) into `TWILIO_VERIFY_SERVICE_SID`.
4. Copy the **Account SID** (`AC…`) and **Auth Token** from the Console home page, **or** create a
   scoped **API key** (Account → *API keys & tokens* → *Create API key*) and set
   `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` instead. API keys can be rotated without
   touching the account token.
5. **Code lifetime:** Twilio Verify's default is **10 minutes** and is set per Service (contact
   Twilio Support to change it). Keep `OTP_TTL_SECONDS=600` in sync — the UI's expiry timer is
   driven by that value.
6. **Trial accounts** can only send to phone numbers verified in the Twilio Console, and include
   a trial message prefix. Upgrade the account (billing) to text arbitrary numbers.
7. **Recommended hardening in Twilio:** enable *Fraud Guard* / geo-permissions for the countries
   you serve, and monitor *Verify → Logs* for anomalies.

Confirm everything without sending an SMS:

```bash
npm run check:twilio
```

Send one real test SMS and check it:

```bash
npm run check:twilio -- --send +919876543210
npm run check:twilio -- --check +919876543210 123456
```

## Configuration

All settings are environment variables; `.env.example` documents each one.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables HSTS, secure cookies and strict secret checks |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | HTTP listener |
| `APP_ORIGIN` | *(empty)* | Comma-separated allowed browser origins for POSTs |
| `TRUST_PROXY` | *(empty)* | Express `trust proxy` (set `1` behind one proxy) |
| `ALLOW_IFRAME_EMBEDDING` | `false` | Allow iframe embedding (previews only) |
| `TWILIO_ACCOUNT_SID` | — | **Required** |
| `TWILIO_AUTH_TOKEN` | — | Required unless an API key pair is used |
| `TWILIO_API_KEY_SID` / `_SECRET` | — | Optional, recommended credential pair |
| `TWILIO_VERIFY_SERVICE_SID` | — | **Required**, starts with `VA` |
| `TWILIO_TIMEOUT_MS` | `12000` | Provider request timeout |
| `SESSION_SECRET` | — | **Required in production**, 32+ chars |
| `SESSION_TTL_SECONDS` | `86400` | Verified-session lifetime |
| `OTP_TTL_SECONDS` | `600` | Must match the Twilio Service TTL |
| `OTP_RESEND_COOLDOWN_SECONDS` | `30` | Minimum gap between sends to one number |
| `OTP_MAX_SENDS_PER_WINDOW` | `5` | Rolling send cap per number |
| `OTP_SEND_WINDOW_SECONDS` | `3600` | Window for that cap |
| `OTP_MAX_VERIFY_ATTEMPTS` | `5` | Wrong-code attempts per verification |
| `OTP_DEFAULT_COUNTRY` | `IN` | UI default when the browser locale is unsupported |
| `OTP_ALLOWED_COUNTRIES` | *(all)* | Optional ISO allow-list, e.g. `IN,US,GB` |
| `RATE_LIMIT_*` | see example | Per-IP limits for global/send/verify scopes |
| `LOG_LEVEL` | `info` | `debug`…`silent` |

## API

All responses are JSON. Success: `{ "ok": true, "data": { … }, "requestId": "…" }`.
Failure: `{ "ok": false, "error": { "code", "message", "retryAfterSeconds?", "details?" }, "requestId" }`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/config` | Public UI configuration (countries, TTLs, provider configured flag) |
| `GET` | `/api/health`, `/healthz` | Liveness + provider configuration (no secrets) |
| `POST` | `/api/otp/send` | `{ phone, country }` → sends a code, sets the session cookie |
| `POST` | `/api/otp/resend` | Resends for the session's number (no body; cooldown enforced) |
| `POST` | `/api/otp/verify` | `{ code }` → verifies with Twilio, marks the session verified |
| `GET` | `/api/session` | Current verification status (verified flag, timers, attempts left) |
| `GET` | `/api/profile` | Verified-only profile data; `403` for unverified sessions |
| `POST` | `/api/session/logout` | Cancels pending verification and revokes the session |

Example:

```bash
curl -i -c jar.txt -H 'Content-Type: application/json' \
  -d '{"phone":"9876543210","country":"IN"}' \
  https://your-app.example.com/api/otp/send

curl -i -b jar.txt -H 'Content-Type: application/json' \
  -d '{"code":"123456"}' \
  https://your-app.example.com/api/otp/verify
```

### Error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_phone` / `invalid_country` | Not a valid number for the selected country |
| 400 | `unsupported_number` | Line type cannot receive SMS (landline) |
| 400 | `invalid_request` | Body failed validation (`details.fields`) |
| 403 | `country_not_allowed` | Destination blocked by `OTP_ALLOWED_COUNTRIES` |
| 403 | `origin_rejected` | Cross-origin state-changing request blocked |
| 403 | `verification_required` | Profile requested by an unverified session |
| 409 | `no_active_verification` | No pending code for this session |
| 409 | `already_verified` | Session is already verified |
| 410 | `code_expired` / `verification_not_found` | Code lifetime over or no longer valid |
| 422 | `invalid_code` | Wrong code (`details.attemptsRemaining`) |
| 429 | `resend_too_soon` / `too_many_sends` / `rate_limited` / `provider_rate_limited` / `attempts_exhausted` | Throttled or out of attempts |
| 502 | `provider_unavailable` / `provider_auth_failed` | Twilio could not be reached or rejected the credentials — **never** counted as success |
| 503 | `provider_not_configured` | Credentials missing; nothing was sent |

## Security model

**Invariants (each has a test):**

1. No code is sent unless the number passes strict E.164 validation.
2. A code is generated and stored **only** by Twilio Verify. OTP Shield cannot read it, log it or
   leak it.
3. A session becomes verified **only** when Twilio returns `status: "approved"`. A wrong code
   (`pending`) is a failed attempt; a provider error is never success.
4. Verification state is server-side. The client cannot set `verified`, and a tampered cookie is
   rejected by signature verification.
5. Resend cooldowns and send caps are enforced **per phone number**, so dropping the session
   cookie does not reset them.
6. Expired codes are rejected before any provider call and cancelled at Twilio.
7. Credentials, service SIDs and provider responses are never sent to the browser.

**Residual risks / scope**

- The default session store is in-process and ephemeral: restarting the server invalidates
  pending and verified sessions (users simply verify again). See
  [Scaling & persistence](#scaling--persistence).
- Rate limits are per process. Use a shared store (`rate-limit-redis`) when running more than one
  instance.
- OTP Shield verifies numbers, it does not authenticate users. Issuing application sessions after
  verification is application-specific.
- Keep `SESSION_SECRET` and Twilio credentials in your platform's secret manager, never in Git.
- Report security issues privately to the repository owner rather than in a public issue.

## Testing

```bash
npm test                # 78 tests: unit + HTTP integration
npm run test:coverage   # with Node's built-in coverage
npm run check:twilio    # real credentials/service check (no SMS)
```

The suite uses `supertest` against the real Express app with a **test double for the Twilio
client** so it is deterministic and never sends SMS. It covers:

| Area | What is asserted |
| --- | --- |
| Sending | Missing/invalid/over-long numbers, `+` country mismatch, E.164 normalisation, masked metadata, signed http-only cookie, no SID leakage |
| Cooldown/retries | 30 s cooldown (`Retry-After`), resend resets attempts, rolling per-number cap, parallel sends cannot race past the cooldown |
| Valid & invalid codes | Correct code verifies; wrong code returns `422` with remaining attempts; forged `verified:true` payload is ignored |
| Attempt limits | Fifth wrong code exhausts attempts; further checks never reach Twilio; even the correct code is refused |
| Expiration | Expired code → `410`, Twilio cancel call, session stays unverified, resend restores a working flow |
| Rate limits | Send/verify/global per-IP limits with `Retry-After`; health checks and disabled mode |
| Provider mapping | Twilio codes 60200/60202/60203/60205/60220/60223/60238/20003/20404/20429, timeouts, DNS/socket failures |
| Security | CSP/HSTS/XFO headers, origin guard, 413/415/404/405 handling, malformed JSON, secret leakage checks, unconfigured → `503` |
| Profile | `403` unverified, `200` verified, logout revokes, tampered cookie rejected |

### Manual test matrix (with real credentials)

Use a real handset. Each row should behave exactly as described.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Enter a valid mobile number → **Send OTP** | Real SMS arrives; stepper moves to step 2; 10:00 countdown starts |
| 2 | Wait for the cooldown, press **Resend code** | Second SMS; attempts reset; cooldown restarts |
| 3 | Enter a wrong six-digit code | Inline error + toast, attempts drop by one, boxes clear, still unverified |
| 4 | Enter the correct code | Success panel, header pill shows **Verified**, profile unlocks |
| 5 | Refresh the page | Verified state is restored from the server session |
| 6 | Wait past the code lifetime, then submit the old code | `code_expired`, verification stays blocked, resend works |
| 7 | Press **Send OTP** 12+ times quickly | `429` with a retry hint; no extra SMS is sent |
| 8 | Stop the server / go offline, press **Verify OTP** | Network-error banner + toast; **no** success state |
| 9 | Open the profile page before verifying | Locked state (`403 verification_required`) |
| 10 | **Sign out**, then open the profile | Locked again; previous session is revoked |
| 11 | Remove Twilio credentials, restart, try to send | Banner "SMS delivery is not configured", send disabled, API `503` |

## Deployment

The app is a single stateless-by-default Node process with no build step: `npm ci --omit=dev &&
npm start`. It reads a JSON health endpoint at `/healthz`.

### Render (blueprint included)

1. Push the repository to GitHub.
2. Render → **New → Blueprint**, select the repo (`render.yaml` is detected).
3. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`,
   `SESSION_SECRET` (and optionally `APP_ORIGIN`) in the dashboard.
4. Deploy, then open `/healthz` — it should return `{"status":"ok","providerConfigured":true}`.

Manual alternative: **New Web Service** → build `npm ci` → start `npm start` → health check
`/healthz` → add the same environment variables.

### Railway

1. **New Project → Deploy from GitHub repo.**
2. Railway detects Node via `package.json` (build `npm ci`, start `npm start`).
3. Add the environment variables, generate a public domain, then set `APP_ORIGIN` to it.

### Fly.io

```bash
fly launch --no-deploy            # uses the included Dockerfile
fly secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... \
  TWILIO_VERIFY_SERVICE_SID=... SESSION_SECRET=$(openssl rand -hex 32) \
  APP_ORIGIN=https://your-app.fly.dev
fly deploy
```

### Docker

```bash
docker build -t otp-shield .
docker run --rm -p 3000:3000 --env-file .env otp-shield
```

### Any Node host (Heroku-style / VPS)

```bash
npm ci --omit=dev
NODE_ENV=production PORT=3000 npm start
```

Use a process manager (systemd, pm2) behind nginx/Traefik with TLS, and set `TRUST_PROXY=1`.
`Procfile` is included for platforms that expect one.

### Production checklist

- [ ] `NODE_ENV=production`, `SESSION_SECRET` ≥ 32 random characters
- [ ] `APP_ORIGIN` set to your exact HTTPS origin(s)
- [ ] `TRUST_PROXY=1` when behind a proxy (so rate limits see the client IP)
- [ ] `OTP_ALLOWED_COUNTRIES` restricted to the markets you serve
- [ ] Twilio Verify Service: 6-digit codes, lookup enabled, Fraud Guard/geo-permissions reviewed
- [ ] Twilio account upgraded if you need to text arbitrary numbers
- [ ] HTTPS enforced at the platform/proxy (HSTS is sent by the app in production)
- [ ] Logs shipped somewhere with access control (they contain masked numbers only)
- [ ] `npm test` green on the deployed commit

## Scaling & persistence

The bundled `MemorySessionStore` keeps sessions, attempt counters and send windows in memory.
That is fine for a single instance and means **no database is required**. Its limits:

- State is lost on restart (users re-verify).
- Multiple instances do not share sessions (use sticky sessions or a shared store).

`src/services/session-store.js` defines a small interface (`createSession`, `getSession`,
`updateSession`, `deleteSession`, `getAbuseRecord`, `pruneSendTimestamps`, `recordSend`,
`stats`, `sweep`). To run multiple instances, implement the same methods over Redis or Postgres
and pass your store into `createApp({ store })` in `src/server.js`. Use
`rate-limit-redis` for the limiters at the same time, and set `TRUST_PROXY` correctly so limits
key on real client IPs.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `503 provider_not_configured` | Missing/partial Twilio env vars | Fill all three (or the API key pair) and restart |
| `502 provider_auth_failed` | Wrong/revoked credentials, or the token belongs to another account | Re-copy the Account SID/token; check `npm run check:twilio` |
| `400 invalid_phone` for a good number | Country selector disagrees with the `+` prefix | Pick the matching country, or drop the `+` |
| `400 unsupported_number` | Landline | Use a mobile number |
| `429 provider_rate_limited` | Twilio's 5 sends / 10 min per number | Wait, or use a different number |
| `429 too_many_sends` | Your own `OTP_MAX_SENDS_PER_WINDOW` | Wait for the window, or raise the limit |
| SMS arrives minutes late | Carrier delay | Twilio Verify codes live 10 minutes; resend after the cooldown |
| `410 code_expired` | User typed the code after the TTL, or asked for a new one | Request a new code |
| Session lost after restart | In-memory store | Verify again, or back the store with Redis |
| Trial account: SMS never arrives | Destination not verified in Twilio | Verify the number in the Twilio Console or upgrade |
| Preview shows a blank iframe | `X-Frame-Options: DENY` | Set `ALLOW_IFRAME_EMBEDDING=true` **only** for previews |

## Project structure

```
.
├── .env.example              # every supported setting, documented
├── Dockerfile                # multi-stage, non-root, health check
├── Procfile                  # Heroku-style platforms
├── render.yaml               # Render blueprint
├── public/                   # zero-dependency frontend
│   ├── index.html            # semantic, accessible markup
│   ├── styles/app.css        # design system, dark/light, responsive
│   ├── js/app.js             # controller: steps, timers, toasts, routing
│   ├── js/api.js             # fetch + typed errors + timeouts
│   ├── js/otp-input.js       # six-box code input
│   ├── js/country-picker.js  # ARIA combobox with search
│   ├── js/toast.js           # accessible notifications
│   └── js/dom.js             # DOM/formatting helpers
├── scripts/check-twilio.js   # real credential + delivery check
├── src/
│   ├── app.js                # Express app factory (injectable deps)
│   ├── server.js             # bootstrap, graceful shutdown
│   ├── config.js             # env validation + public config
│   ├── errors.js             # error model and messages
│   ├── logger.js             # structured logs with masking/redaction
│   ├── middleware/           # security, rate limits, request ids, errors
│   ├── routes/               # public, otp, session
│   ├── services/
│   │   ├── verify-provider.js      # the only Twilio integration
│   │   ├── verification-service.js # cooldowns, attempts, expiry, approval
│   │   ├── session-store.js        # TTL store + per-key lock
│   │   └── phone.js                # E.164 validation + masking
│   └── utils/validate.js
└── test/                     # node:test + supertest suites
```

## License

MIT — see [LICENSE](LICENSE).

OTP Shield is not affiliated with Twilio. Twilio Verify is a trademark of Twilio Inc.
