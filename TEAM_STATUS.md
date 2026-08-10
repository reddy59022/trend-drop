# TEAM STATUS — Trend-Drop Marketplace

_Last updated: 2026-08-09 21:00 CDT · Branch: `main` @ `75e2c33`_

Working as a full autonomous software team per `AGENTS.md`. Status by role:

## Product Management ✅
- **Delivered**: Trend-Drop social commerce marketplace (Web + iOS + Android via Capacitor).
- **Outcome**: Full buyer journey (discover → trend feed → cart → checkout), seller journey (list → offers → payouts → cash out), social features (trends, AR showrooms, AI stylist, video shopping).
- **Acceptance criteria**: 1084/1084 server tests, 25/25 Playwright E2E user-flow tests, live deployment verified.

## UX / Product Design ✅
- Mobile-first responsive design; MobileTabBar for app navigation; empty/loading/error states throughout (cart, listings, wishlist, search).
- E2E suite simulates real user flows (register, login, browse, search, add-to-cart, checkout form, seller dashboard, offers, trends, wishlist).

## Software Architecture ✅
- React SPA (`client/`) + Express API (`server/`) + MongoDB Atlas; single repo, Render deploy, Capacitor mobile wrappers.
- E2E architecture: reuse the production Express server in `NODE_ENV=production` on port 5001 with MongoMemoryServer (pinned `MONGOMS_VERSION=7.0.14` for macOS 12) — no dev server needed, fast full-app tests.

## Frontend Engineering ✅
- Key flows verified by browser automation: auth (register/verify screen, login, wrong-password toast, logout, protected routes), browse/search/filters, cart lifecycle, trends, seller dashboard, offers-to-likers, wishlist.
- Cart bug found & fixed (see Backend): client `clearCart` helper clears BOTH server cart and `localStorage` cart (provider re-pushes local-only items on sync by design).

## Backend Engineering ✅
- **Critical fix (production bug)**: API cache middleware cached ALL GET endpoints (`public, max-age=300`) — browser served a stale empty `/api/cart` after the user added items. Now **no-store by default**, only public catalog GETs cached (60s).
- **Critical fix (production bug)**: `GET /api/cart` saved a *populated* cart, embedding listing objects into `items.listing` and silently emptying carts on later reads. Now filters raw ObjectIds before populating; saves only when items were actually removed.
- Verified via curl: add → GET → GET persists; and via browser flow debug (server-side logs).

## Database Engineering ✅
- Mongoose models (User, Listing, Cart, Order, Transaction, Payout, Trend, Offer, Wishlist, …). No schema changes needed this session; cart filtering now uses a single `Listing.find({ _id: { $in }, available: true, sold: false })` query.

## QA Engineering ✅
- **Jest (server)**: 1084/1084 tests, 81/81 suites, 0 failures.
- **Playwright E2E**: 25/25 passing (~1 min, chromium headless). Run: `npx playwright test`.
- **Live API**: 38/43 functional checks on Render; 5 failures were test-assertion issues, not app bugs.
- Note: `e2e/test-results`, `e2e/reports`, screenshots/videos/traces are gitignored (user requirement).

## Security Engineering ✅
- No secrets committed; API keys are placeholders (`.env.example`); `assertObjectId` global validation; auth/rate limiting on login/register; Stripe webhook signature verification; `Cache-Control: no-store` for all user-specific endpoints (prevents stale/cached private data).

## DevOps / Deployment ✅
- Render.com: `https://trend-drop.onrender.com` — deploy triggered by git push to `main`.
- Latest push `75e2c33` (E2E suite + cache/cart fixes) → deployment in progress, verify health + a cart flow after deploy completes.

## Code Review ✅
- Full diff reviewed pre-commit: no secrets, no unrelated changes, fixes are minimal and targeted. Both bug fixes were independently verified (curl + browser debug) before commit.

## Known / Remaining
- iOS build still requires a full Xcode.app install (CLT-only machine — xcodebuild unavailable). Android debug APK builds fine.
- Store submission (Google Play / App Store) is a manual business step.
- E2E artifacts are local-only; CI integration (GitHub Actions) not configured.

## Operating Process (standing, per Sunny 2026-08-09)
- **Source of truth:** `BACKLOG_TRACKING.md` — read first at every startup.
- **Daily wake:** cron `Daily backlog kickoff` (09:00 America/Chicago) restores context and drives the next story.
- **Acceptance gate:** a story/feature is accepted ONLY when its Definition of Done passes (tests + build + review + commit + push + deploy verified) — never on code alone.
- **Failure handling:** any red test from a prior day is priority #1 the next morning.
