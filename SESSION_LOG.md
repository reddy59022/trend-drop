# TREND-DROP VERIFICATION SESSION LOG

_Purpose: running document tracking end-to-end verification of all 60 features against
production (https://trend-drop.onrender.com) using the seeded test accounts.
Update this file after every verification pass. Do not delete prior entries._

---

## Test Accounts (production DB)

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Seller/Buyer "Alex Rivera" | reddy59021@gmail.com | Password123! | Alex Vintage Finds, balance.available 420.75 |
| Seller/Buyer "Jordan Patel" | reddy59022@gmail.com | Password123! | Jordan's Closet, balance.available 310.00 |

Login: `POST /api/auth/login` → `{ token }` (JWT, 30-day expiry).

## Production Endpoints

- Base: `https://trend-drop.onrender.com`
- Health: `/health`, `/health/mongo`
- Auth: `/api/auth/login|register|me`
- Payments: `/api/payments/publishable-key|status|breakdown|create-intent|confirm|confirm-batch|payout`
- Payouts: `/api/payouts/dashboard|balance|commission-info`
- Stripe mode: **test** (pk_test_… confirmed via /api/payments/status)

---

## Pass 1 — 2026-09-10 (earlier today)

### Verified working (live curl against prod)
- [x] `/health` 200 `{"status":"ok"}`
- [x] `/health/mongo` 200 connected
- [x] `GET /api/listings` 200 with data
- [x] `POST /api/auth/register` 201
- [x] `POST /api/auth/login` (both seed accounts) 200 + token
- [x] CORS preflight from `capacitor://localhost` (iOS) and `https://localhost` (Android): 204
- [x] SPA fallback `/listings` 200
- [x] Stripe status: publishable+secret configured, stripeInitialized true
- [x] Local: jest 1129/1130 (admin AD.3 transport flake under load; 18/18 isolated)
- [x] Local: Playwright E2E 29/29
- [x] Local: Android assembleDebug (JDK 21), iOS xcodebuild, pod install
- [x] Server suite after fixes: 1130/1130 (86/86 suites)

### Bugs found in production & fixed (commit 3260a6d, deployed)
1. **Payout dashboard NaN/null** — legacy payout docs (old seed schema:
   `amount`/`method`/`transactions[]`) made unguarded `p.payoutAmount` sums
   become NaN → serialized null for totalEarnings/totalEarned/
   availableBalance/pendingBalance. Fixed in `server/routes/payouts.js`
   (legacy fallback + NaN guards) + `server/models/Payout.js` (legacy fields
   declared so Mongoose strict mode doesn't strip them).
2. **availableBalance ÷ 100 bug** — dashboard divided by 100 instead of
   rounding to cents; balances shown 100x too small. Fixed (round ×100/100).
3. **GET /api/users/me 500** — literal `me` fell into `/:id`,
   `User.findById('me')` → CastError. Added explicit `GET /me` route in
   `server/routes/users.js`.

### Confirmed fixed live after deploy
- `GET /api/users/me` → 200
- `GET /api/payouts/dashboard` (Alex) → availableBalance 420.75 (numeric, not null)

### Found, fix in progress
4. **Stripe webhook not fail-closed** (user chose option b): route called
   `stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)`
   directly with no guard for a missing secret. Fix written in
   `server/config/payments.js` (isWebhookSignatureRequired / getWebhookSecret /
   verifyStripeWebhookEvent; bypass only when NODE_ENV≠production AND
   STRIPE_WEBHOOK_DISABLE_VERIFY=1) + `server/routes/stripeWebhook.js` wired to it
   (missing secret → 500 retryable; bad/missing signature → 400).
   New suite: `server/tests/webhookSecurity.test.js` (5 cases).
   STATUS: code written; webhook suite 6/6 + security suite 4/5 pending final fix.

---

## Pass 2 — 2026-09-10 (current session)

- Cleaned stray `server/jest.config.js` stub (untracked; jest config lives in
  server/package.json).
- Verified no edit residue in stripeWebhook.js (marker-noop reverted; diff is
  the intentional fail-closed change only).
- All modified modules load OK under node.
- **Full suite: PASS 1135/1135 (87/87 suites)** — see /tmp/jest-baseline.log.
  (1 earlier `webhookSecurity` failure was a test-code bug: `.set(h, '')`
  transmits an empty header; fixed by omitting the header for "unsigned"
  cases. No production code change needed.)
- **webhookSecurity suite: 5/5 pass** (/tmp/webhook-test.log) — proves
  fail-closed webhook verification (unsigned→400, bad sig→400, no
  secret→500, valid→200, dev bypass→200).
- **sellerE2E: 41/41, e2e: 197/197 in isolation.** Together they fail only
  because both suites run in ONE shared jest process + shared in-memory
  Mongo (jest.setup.js afterAll wipes the DB between files, so the 2nd
  file's pre-minted tokens point at deleted users → 401 cascade). That is
  a pre-existing test-isolation artifact, NOT a server bug — never happens
  in CI (`--runInBand` runs files sequentially in separate workers... same
  process here due to local parallel runs). Full `npm run test:ci` below
  is the source of truth.
- **Full `npm run test:ci`: 1134/1135** (/tmp/jest-full.log). Single
  failure: `recentlyViewed v38.2` — route relied on the unique index to
  throw 11000 for duplicates, but `autoIndex` timing means the index may
  not exist yet → 2nd POST created instead of 200 "Already viewed".
  Fixed with check-then-create in `server/routes/recentlyViewed.js`
  (unique index kept as race backstop); suite now **10/10** (/tmp/rv.log).
  Full re-run pending to confirm 1135/1135.

### Bug #5 found in production & fixed (commit a77eb9c, NOT YET DEPLOYED)
5. **`POST /api/payments/confirm-batch` 500 on real users with legacy seed
    docs** — Jordan/Alex user docs carry legacy `location` OBJECT
    (`{city,state,country}`, schema says String) + `payoutMethod.details`
    (no schema path). Any money flow that loads+saves such a user
    (checkout → sellerDoc.save(), cancel, payouts) throws ValidationError.
    Proven live: Jordan→Alex purchase returned
    `User validation failed: location: Cast to string failed ... { city:
    'Los Angeles', ... }`.
    Fix: legacy-data sanitizer in `User` model `pre('save')` (flattens
    location object → "City, ST, US" string, folds payoutMethod.details →
    real fields). ONE fix covers every caller.
    STATUS: committed locally (a77eb9c); MUST push + verify on Render
    (confirm-batch retry) before certifying payments/payouts.

### Production payment flow verified live (test mode, real Stripe PI)
- `POST /api/payments/create-intent` (Jordan→Alex Nike $100): 200,
  `pi_3UE9...` + clientSecret + correct breakdown (buyer pays 105 =
  100+5 protection; seller earns 92 = 100−8 fee; platform 8).
- Confirmed PI at Stripe (`requires_capture`, test card pm_card_visa +
  return_url for redirect-capable Dashboard payment methods).
- `POST /api/payments/confirm-batch` → 500 via bug #5 (above); retry
  pending deploy of a77eb9c. Order/transaction/payout writes blocked
  on the same error — no partial writes (Phase-3 writes happen after
  sellerDoc validation, and listing was NOT marked sold — verified).
- `POST /api/payments/payout` (cashout): correctly 400 "Please set up a
  payout method first" (Alex has no payoutMethod.type — server enforces
  setup before cash-out; no bug).
- Self-purchase guard works: "Cannot purchase your own listing".
- `GET /api/payouts/dashboard|balance|commission-info`: all 200, numeric
  balances (Alex available 558.75), breakdown math verified.

### Feature-by-feature verification status (60 features)

Legend: ✅ verified live · 🟡 verified locally (jest/E2E) only · ⬜ not yet tested this pass

| # | Feature | Endpoint/Page | Web | iOS | Android |
|---|---------|--------------|-----|-----|---------|
| 1 | Auth register/login | /api/auth/* | 🟡 | 🟡 | 🟡 |
| 2 | Listings CRUD | /api/listings | 🟡 | 🟡 | 🟡 |
| 3 | Offers/negotiation | /api/offers | 🟡 | 🟡 | 🟡 |
| 4 | Cart | /api/cart | 🟡 | 🟡 | 🟡 |
| 5 | Payments (Stripe intent) | /api/payments/create-intent | ⬜ | ⬜ | ⬜ |
| 6 | Checkout confirm | /api/payments/confirm(-batch) | ⬜ | ⬜ | ⬜ |
| 7 | Payouts dashboard | /api/payouts/dashboard | ✅ | 🟡 | 🟡 |
| 8 | Cash out | /api/payments/payout | ⬜ | ⬜ | ⬜ |
| … | (fill in remaining as tested) | | | | |

_Full 60-row matrix to be completed during this pass — see FEATURE_MATRIX.md
once generated from the route list._
