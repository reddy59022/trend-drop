# RESUME.md — Live Mission State (read this on every wake)

_This file is the durable continuation state. On ANY wake (cron, message, heartbeat), read this + `BACKLOG_TRACKING.md`, then continue the current step until the mission completes. Update this file whenever the active step changes._

## Mission
Drive the 31-story backlog (TD-1.1 → TD-10.3, tracked in `BACKLOG_TRACKING.md` + `PRODUCT_BACKLOG.md`) through Definition of Done: implement → jest ≥1084 green → Playwright ≥25/25 green → client build → review → commit+push → Render verified → tracker updated.

## Current Focus
**TD-1.1 Stripe test-mode payments** — code-complete; remaining:
1. Security review of `server/routes/stripeWebhook.js` (payment_intent.succeeded case at line 144) + `server/config/payments.js` (verifyStripeWebhook line 189).
2. Add `e2e/tests/stripe-checkout.spec.js`: full checkout with Stripe test card 4242… — auto-skip when `STRIPE_PUBLISHABLE_KEY`/`STRIPE_SECRET_KEY` absent; activates when keys provided (Playwright fills Elements iframe).
3. Live verification QUEUED on Sunny's Stripe test keys (STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET) — then run jest webhook suite against real test events + E2E card checkout, mark Accepted.
4. Then TD-1.2 Cloudinary (live keys), TD-1.3 Brevo (live keys), TD-1.4 social sign-in (live keys)… — each code-complete + mocked tests, live check queued.

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

## Working Copy State
- Uncommitted changes from TD-1.1 work in progress: `server/routes/payments.js`, `server/routes/stripeWebhook.js`, `e2e/helpers.js`, `e2e/tests/cart.spec.js`, `server/e2eServer.js`, new files `e2e/tests/stripe-checkout.spec.js`, `server/tests/stripeWebhook.test.js`, `scripts/`, `BACKLOG_TRACKING.md`.
- These changes need security review, test completion, and validation before commit.
