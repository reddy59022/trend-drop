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
- Full suite baseline re-run: (PENDING — see /tmp/jest-baseline.log)

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
