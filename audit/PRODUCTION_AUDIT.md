# TrendDrop — Production Audit (24 Oct 2026)

Target: https://trend-drop.onrender.com · signed in as both supplied accounts
(`reddy59021@gmail.com`, `reddy59022@gmail.com`). Deployed commit: `3444646`.

## 1. Functional matrix (live production API + UI)

Every endpoint below was called with a real session token against the production
database. Read-only checks used both accounts; write checks created data with a
`TD QA …` prefix and deleted it immediately (verified removed).

| Area | Endpoint | Result |
| --- | --- | --- |
| Auth | `POST /api/auth/login` (both accounts), `GET /auth/me` | 200 |
| Catalog | `GET /listings`, `/listings/search?q=dress`, `/listings/my`, `/users/:id/closet`, `/users/feed` | 200 |
| Listing CRUD | create draft → update price → anonymous read of draft → owner read → delete | 201 / 200 / **404 as designed** / 200 / 200 |
| Wishlist | add → list → remove | 200, item present, 200 |
| Cart | add own listing → add → remove | 400 (own listing blocked, correct) / 200 |
| Saved search | create → results → update → invalid filter → delete | 201 / 200 / 200 / **400 "filters.minPrice must be a number"** / 200 |
| Offers | `/offers/sent`, `/offers/received` | 200 (3 sent, 76 received) |
| Orders | `/orders`, `/orders/:id`, `/transactions` | 200 |
| Payouts | `/payouts/dashboard`, `/payouts/balance`, `/payouts/commission-info` | 200, `commissionRate 0.08` |
| Payments config | `/payments/publishable-key`, `/payments/status`, `/payments/commissions`, `/payments/platform-fee` | 200 |
| Shipping | `/shipping/carriers` (6 carriers), `/countries` (98), `/advanced-shipping`, `/shipping-insurance/my` | 200 |
| Returns | `/returns` | 200 (2 records) |
| Auctions | `/auctions`, `/auctions/settings` | 200 |
| Escrow | `/escrow/settings` | 200 |
| Loyalty / referrals / badges | `/loyalty`, `/loyalty/history`, `/referrals/my`, `/referrals/settings`, `/seller-badges/me` | 200 |
| Subscriptions | `/subscriptions`, `/subscriptions/plans` (4 tiers) | 200 |
| Analytics / inventory | `/analytics/dashboard`, `/analytics/sales`, `/analytics/inventory`, `/inventory` | 200 (30-day series, per-category stock) |
| Enterprise | `/enterprise/listings`, `/enterprise/orders` | 200 |
| Promos / boost | `/promos` (13 codes), `/shop-boost` | 200 |
| AI stylist / trends / size guides | `/ai-stylist/recommendations`, `/trends`, `/size-guides` | 200 |
| Legal / fraud / features | `/legal/consent-status`, `/fraud/settings`, `/config/features` | 200 |
| Admin guard | `/admin/dashboard` as a normal user | **403** (correct) |
| Static app | `/`, `/health`, `/health/mongo` | 200 / ok / mongo connected |

Not executed: charging a card, capturing funds, issuing refunds, releasing
payouts, generating a live carrier label. These move real money and would need
test-mode keys and explicit confirmation; everything up to the money step was
verified (validation, ownership, config and read surfaces).

## 2. Defects found and fixed in this pass

1. **Fabricated marketplace figures (deceptive advertising).**
   The landing page hard-coded `50K+ Active Sellers`, `1M+ Items Listed`,
   `99% Buyer Protection` and per-category counts (`12.5K items` …), none of
   which any query backed — the real catalog is **273 items**. Replaced with a
   public `GET /api/listings/marketplace-stats` (active, in-stock, unsold only,
   5-minute cache) plus one true constant (8% flat commission). Category tiles
   now show live counts and show none when a category is empty.
   Tests: [server/tests/marketplaceStats.test.js](../server/tests/marketplaceStats.test.js),
   [client/src/pages/__tests__/Home.test.js](../client/src/pages/__tests__/Home.test.js).
2. **Route shadowing by the global id guard.** `/api/listings/marketplace-stats`
   was rejected with `400 Invalid listing ID` because `validateObjectId`
   matched it as `/:id`. The guard now exempts it, so new public listing
   sub-routes cannot be broken the same way.
3. **Mobile hero pushed both CTAs below the fold.** At 390×844 the kinetic
   hero measured 869px with 58.5px type and 112px top padding. The tightening
   added in `responsive.css` was silently overwritten by `design-haul.css`
   (imported later), which is itself a defect worth knowing about: five CSS
   layers stack on this app and the last one wins. The rules now live at the
   end of `design-haul.css`: hero 869px → **588px**, headline 58.5px → 35.1px,
   both CTAs fully visible on the first screen.
4. **Three-row mobile header.** Logo (~230px) + five global controls could not
   share a 390px row, so the controls wrapped and the search box became a third
   row. Logo mark and utility hit areas now shrink below 480px: logo + controls
   + menu on one row, search on the second (verified in the deployed build).

## 3. UI/UX audit — issues found, ranked

### Trust and content (highest impact)
1. **Test/junk inventory in production.** The catalog is dominated by
   `PROD-E2E 20260911…`, `$32_20260915094524_prod3 return-item`, `QA Test Item`.
   This is the single biggest reason the marketplace does not look credible.
   Needs a data cleanup (separate approval) and seeding with real products.
2. **Missing images.** Most cards render the generated "TRENDDROP PHOTO COMING
   SOON" placeholder. A marketplace lives on photography; nothing in the UI can
   compensate for this.
3. Competitor fee table on the landing page lists Poshmark 20% / Mercari 10% /
   Depop 10% without a date or source — legally risky if left unqualified.

### Navigation and first impression
5. Desktop header carries three global dropdowns (country, currency, language)
   plus theme next to the account menu — five utility targets competing with
   search. (Phone wrapping fixed; the desktop density is still open.)
6. No category navigation in the header — "Feed / Browse / Sell" only.
7. Hero is the whole first screen on desktop too; no products are visible
   without scrolling (desktop `min-height: 92svh`).
8. The homepage repeats the same seller pitch three times (hero CTA,
   commission block, closing CTA).

### Consistency
9. Mixed typography roles: Sora for headings, Inter for body, Cormorant for the
   hero serif, plus emoji used as category icons — reads less premium than an
   icon set.
10. Dark-mode-first palette; light mode exists but the hero stays dark in both,
    so the brand reads inconsistent between themes.
11. Section spacing varies page to page (dashboard uses `page-container`,
    home uses `.container` + `.section`), producing uneven rhythm.
12. **Five stacked CSS layers** (`globals`, `App`, `append-to-app`,
    `responsive`, `design-haul`, `dashboard-bespoke`) with no ownership rules:
    a fix in the wrong layer silently does nothing (this bit the mobile hero).

### Accessibility / ergonomics
13. Header icon-only actions (bell, heart, mail, bag) are labelled for screen
    readers but have no visible text or tooltips on desktop.
14. Mobile tab bar floats over content; the last row of cards can sit behind it.
15. Hero trust row drops to 11.5px text on mobile.

### Seller surfaces
16. Dashboard headline metrics are hard to reconcile: "Total Sales $7,560.04",
    "Your Earnings $150.00", "Pending Payout $2,203.50". The API returns
    `totalSales 7560.04`, `totalEarnings 150`, `pendingBalance 2203.50`,
    `totalPaidOut 420.75` — the labels do not explain the relationship, and
    `totalCommission 1038.36` is 13.7% of gross, not the 8% advertised. Needs a
    product decision on definitions before changing numbers.
17. `GET /listings/my?status=draft` returns nothing unless `available=false` is
    also sent (the `available` default is `true`); the API is easy to misuse.

## 4. Recommended next steps

1. Clean the production catalog of E2E/QA listings and seed real inventory with
   photography (needs explicit approval; it deletes production rows).
2. Rebuild the header for desktop: category mega-nav, and move
   country/currency/language/theme into one account/settings sheet.
3. Reconcile the seller dashboard money labels with the API and show the true
   effective commission.
4. Replace emoji category icons with a single icon set and unify section
   spacing tokens across pages.
5. Add an "About the fee comparison" footnote with a date and source.
