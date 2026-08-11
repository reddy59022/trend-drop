# RESUME.md — Live Mission State (read this on every wake)

_This file is the durable continuation state. On ANY wake (cron, message, heartbeat), read this + `BACKLOG_TRACKING.md`, then continue the current step until the mission completes. Update this file whenever the active step changes._

## Mission
Drive the 31-story backlog (TD-1.1 → TD-10.3, tracked in `BACKLOG_TRACKING.md` + `PRODUCT_BACKLOG.md`) through Definition of Done: implement → jest ≥1084 green → Playwright ≥25/25 green → client build → review → commit+push → Render verified → tracker updated.

## Current Focus
**TD-1.1 Stripe test-mode payments** — code-complete + security-reviewed + E2E green (keyless mode); remaining ONLY live verification:
1. ✅ Security review of `server/routes/stripeWebhook.js` (payment_intent.succeeded guard, dispute idempotency) + `server/config/payments.js` (verifyStripeWebhook) — DONE in commit 888f492.
2. ✅ `e2e/tests/stripe-checkout.spec.js` added: full checkout with Stripe test card 4242… — auto-skip when keys absent, activates when real TEST keys provided. `cart.spec.js` key-gated to match (commit 6903685).
3. ⏳ LIVE VERIFICATION QUEUED on Sunny's Stripe TEST keys (STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET) — then run jest webhook suite against real test events + E2E 4242 card checkout, mark TD-1.1 Accepted.
4. **TD-1.2/1.3/1.4 moved to In QA (key-independent test hardening done, commit c3515cd):**
   - TD-1.3 Brevo: new EM.1–EM.7 suite exercises REAL config/email.js (keyless skip, keyed send via mocked SDK, FRONTEND_URL/CLIENT_URL/localhost fallbacks, slash stripping).
   - TD-1.4 social: SOCIAL.7–10 add Google create/link/email-mismatch coverage (Apple+Facebook already covered).
   - TD-1.2 Cloudinary: upload routes + mocked SDK tests already green (imageUpload/boost).
   All three still need LIVE keys to Accept: Cloudinary (CLOUDINARY_*), Brevo (BREVO_API_KEY), Google/Apple/FB (client ids).

## Local verification (2026-08-10, heartbeat 19:50)
- jest: **1101/1101 green** (83 suites; +11 new: EM.1–EM.7 email module, SOCIAL.7–10 Google OAuth) — commit c3515cd
- Playwright: **25 passed / 1 key-gated skip** (stripe-checkout live card test skips without keys)
- Render health: `{"status":"ok"}`

## Completed
**TD-8.1 CI pipeline** — Accepted 2026-08-10. CI run #4 green (GitHub Actions run 31417224258, commit 6f4d4e6). Full pipeline: npm ci (npm 10) → jest 1084/1084 → client build (eslint warnings non-blocking) → Playwright 25/25 headless. All four commits (19e567b → 18fad9b → fb6eb84 → 6f4d4e6) pushed and verified.

## Key Environment Facts
- Repo: `/Users/owner/Desktop/trend-drop`, branch `main`, remote github.com/reddy59022/trend-drop (public).
- CI = GitHub Actions `.github/workflows/ci.yml` (Node 20/npm 10; jest 1084 → build → Playwright 25 headless). Render deploys on push to main (nodeVersion 20).
- npm 10 vs npm 11 trap: never regenerate lockfiles with npm 11; always `npx -y npm@10 install` after `rm -rf node_modules`. `npm ci --dry-run` is NOT a reliable check.
- GitHub API token: `TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | sed -n 's/^password=//p')` — never print it.
- Never leave `node_modules.bak` in the repo (jest scans it).
- Memory index is broken (`openclaw memory index --force` needed — user action); memory/*.md files still read/write fine.
- Sunny = owner; reports go to Telegram. Keys (Stripe/Cloudinary/Brevo/Google) still pending from Sunny.

## Progress Log (2026-08-10)
- 19e567b: CI workflow written + E2E cart fix; run #1 failed (npm ci EUSAGE, lockfiles stale for npm 10).
- 18fad9b: lockfiles regenerated with npm 10 (gcp-metadata@7.0.1, yaml@2.9.0 nested entries); run #2 failed (boost.test.js — Cloudinary 500, no keys on runner).
- fb6eb84: Cloudinary SDK mocked in server/jest.setup.js (hermetic, deterministic URLs); local: boost 38/38, full suite 1084/1084. Run #3 failed (client build: eslint warnings as errors under CI=true).
- 6f4d4e6: CI=true kept for tests, overridden to false for build step (pre-existing eslint warning debt tracked as follow-up). Run #4 GREEN.
- **TD-8.1 Accepted.**
- 888f492: TD-1.1 webhook/checkout security hardening (idempotency, CastError guard, server-side negotiatedPrice, key-gated E2E, 6 webhook tests). Pushed.
- 3e48474: tracker sync for TD-1.1 state.
- 6903685: cart.spec.js checkout test key-gated (iframe assert only with real keys; keyless asserts 'payment system not loaded' toast). Full E2E 25 passed / 1 skip.
- c3515cd: TD-1.3 email module suite EM.1–EM.7 + Google OAuth SOCIAL.7–10; jest 1101/1101 (83 suites). Pushed. TD-1.2/1.3/1.4 → In QA (live verify queued on keys).

## Working Copy State
- Clean (`git status` empty). TD-1.1 fully committed: 888f492 + 6903685.
