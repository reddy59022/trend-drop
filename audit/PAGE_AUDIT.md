# TrendDrop — 100% Page Audit (25 Oct 2026)

Complete UI/UX audit of **all 63 pages** (`client/src/pages`) plus shared
components. Every page was checked with the same battery; every finding was
fixed with tests. Companion to `PRODUCTION_AUDIT.md` (functional matrix +
ranked issues), which this pass completes.

## 1. Methodology — the battery

Every page and component scanned for each class; per-class results below.
Scans are exhaustive over `pages/`, `components/`, `context/`, `services/`.

| # | Check | Scope | Result |
| --- | --- | --- | --- |
| 1 | Images without `alt` | all pages/components | 0 (windowed scan — multi-line JSX false positives confirmed) |
| 2 | Icon-only buttons without accessible name | all | 0 — fixed in the a11y pass (25+ labels), regression test `a11yButtons.test.js` |
| 3 | Form inputs without any accessible name | all | 0 — 12 unlabeled inputs fixed in the a11y pass |
| 4 | `alert()` / `window.confirm()` | all | 0 — `ConfirmContext` used throughout |
| 5 | Raw error objects shown to users | all | 0 — every page sets friendly error copy |
| 6 | Pages with API calls but no `catch` | all | 0 |
| 7 | Fetch flows without a loading state | all | 0 (ternary or early-return spinner patterns) |
| 8 | List screens without an empty state | all list pages | 0 — verified Home, Search, Feed, Closet, AuctionPage, InventoryManagement, LoyaltyProgram, ReturnsCenter, Messages, Offers, Transactions, Reviews, Notifications, Collections, SavedSearches |
| 9 | Hard-coded `$` money bypassing `formatPrice` | all | 6 fixed this pass (see §3); 0 remaining outside share copy |
| 10 | Emoji used as UI icons | all | ~45 fixed across 26 files this pass; 0 remaining except share-copy text |
| 11 | Clickable `div`/`span` without keyboard access | all | 3 fixed (Transactions expand row, EditListing boost tiers, Messages listing chips); modal-overlay click-away patterns left as-is (close buttons + Escape cover keyboard) |
| 12 | `target="_blank"` without `rel="noopener"` | all | 0 |
| 13 | Dead links (`href="#"`) | all | 0 |
| 14 | `console.log` noise in production | all | 16 → `console.debug` (WebRTC/Stripe diagnostics kept available under Verbose) |
| 15 | Buttons inside forms without `type` | all | 0 real (all hits were `type=` on the next line) |

## 2. Per-page status

All 63 pages pass the full battery. Pages with fixes in this audit cycle:

| Page | Fixes |
| --- | --- |
| Home | honest marketplace stats + footnote (prod audit #1/#3), hero redesign + light mode, removed duplicated seller CTA (also fixed a mislink to the seller dashboard), trust-row 11.5→12.5px, emoji→icons |
| Navbar (shared) | one preferences popover replaces 4 competing utility buttons (country/currency/language/theme), category mega-menu, Escape/outside-click dismissal, icon tooltips |
| ListingDetail | offer-status chips → icons, `FaClock` import caught by the CI lint gate |
| Cart | quantity-stepper labels, empty-state icon, toast emoji |
| Sell / EditListing | labeled inputs, video-remover labels, truthful 8% fee hint, shipping warning → icon, boost-tier cards keyboard-operable (`role=button`/`aria-pressed`) |
| SellerDashboard | metric captions (gross vs released vs owed), currency-aware promo picker, empty-state icons, auto-offer note icon |
| Admin | labeled action buttons (suspend/delete/etc.) |
| Transactions | filter tabs → icons, expand row keyboard-operable (`aria-expanded`), error/empty icons |
| Offers | status labels de-emojified (badge colors carry semantics), window chips → icons |
| AuctionPage / AuctionDetail / CreateAuction | status + countdown → icons, auction currency, WebRTC logs → `console.debug` |
| Profile | social links → brand icons, seller stats → icons |
| Search / Closet / Feed | sort options de-emojified (native `<option>` can't hold icons), empty-state icons |
| PriceSuggestion / OfferSharing / Subscriptions | all money through `formatPrice` (respects the user's currency) |
| Referrals | reward money in share text through `formatPrice`, empty-state icons (share-copy emoji kept — social convention) |
| SellerBadges | tier icons → `FaMedal`/`FaGem`/`FaTag` JSX, benefit checks → `FaCheck`, current-tier star → `FaStar` |
| FraudProtection | decision chips → plain text (status color carries semantics) |
| Messages | listing chips keyboard-operable, empty-state icons |
| ReturnsCenter / Reviews / Wishlist / LoyaltyProgram / InventoryManagement | empty-state icons, label fixes (earlier passes) |
| NotFound / ForgotPassword / ResetPassword / VerifyEmail / Login | hero/error icons → icon set, toast emoji stripped |
| MobileSettings / Parties / SizeRecommendation / LiveEvents / ARShowrooms / SocialCommerce / BulkListingManager | empty-state icons, toast emoji stripped |
| Collections / SavedSearches | editor input labels, delete-action labels (earlier passes) |
| ReportModal / ChatModal / CommentSection / ErrorBoundary / StripeCheckoutForm / ShopBoostCard (shared) | reason/empty/error icons → icon set, toast emoji stripped |
| Admin / LegalCenter / LegalDocument / LegalAdmin / Settings / Notifications / OrderDetail / RecentlyViewed / Trends / TrendForecast / SellerAnalytics / SellerCommunities / SellerOnboarding / Subscriptions / EnterpriseApi / CrossBorder / AdvancedShipping / Vendors / UnsupportedRegion / VideoShopping / AIStylist / VirtualTryOn | battery clean (earlier passes fixed labels/icons where found) |

## 3. Money display contract (now uniform)

- **Displays** use `formatPrice(amount, recordCurrency)` — converts to the
  user's preferred currency (the header preferences control).
- **Money-input hints** (offer/bid/price fields) use `formatPriceRaw` — the
  number typed is submitted in the record's currency and must not convert.
  `OfferModal` counter/offer hints were the last hard-coded `$` inputs and now
  follow this contract.
- Share copy (Referrals) formats money through `formatPrice` too.

## 4. CSS stack ownership (production audit item 12)

The "five stacked layers, last one wins" trap is resolved two ways:

1. **121 provably-dead rules removed** — top-level rules in earlier layers
   fully shadowed by a later layer's same-selector superset (e.g. 96 in
   `App.css`, 14 in `globals.css`, 10 in `append-to-app.css`). Detection was
   conservative: identical selector text, every property re-set later, and
   `!important` early rules were excluded (they still win). Re-analysis
   reports **0 dead rules**. Verified by 598 unit tests + 294 browser E2E.
2. **Ownership banners** on all six layers declaring stack position and where
   new rules belong (visual → `design-haul.css` 5/6; dashboard polish →
   `dashboard-bespoke.css` 6/6; never `App.css`).

## 5. Catalog cleanup tool (production audit item 1)

`server/scripts/clean-qa-listings.js` (+ `npm run listings:clean-qa[:apply]`),
same operator contract as `reconcile-settlements.js`: dry run by default,
prints its target database before doing anything.

- Detection (`server/utils/qaListingCleanup.js`) is deliberately tight — only
  unmistakable test artifacts (`PROD-E2E…`, `QA Test Item…`, `TD QA…`,
  transaction-artifact titles) — pinned both directions by
  `server/tests/qaListingCleanup.test.js` (23 tests).
- Junk with commerce history (transactions/orders/offers) is **never** deleted
  silently; it is reported for manual review.
- Verified end-to-end against an in-memory Mongo: dry run writes nothing;
  `--apply` deleted exactly the clean junk and protected history + real
  listings.
- **Production run is one command** (`npm run listings:clean-qa` first, then
  `:apply`) — needs the production `MONGO_URI`, which lives only in the
  Render environment. Deletion of production rows awaits explicit approval.

## 6. Remaining items (external / out of audit scope)

1. Production catalog cleanup execution (above) — awaits go-ahead.
2. Missing listing photography (data work, not UI).
3. CRA build-tooling advisories (~188, 0 critical) — need a Vite migration.
4. Live money flows (charge/capture/refund/payout/label purchase) — need
   Stripe test keys; everything up to the money step is covered by the
   mocked E2E suite (294 scenarios).
