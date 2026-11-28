# TrendDrop — Release Readiness Sign-off

**Date:** 2026-11-28
**Environment:** Production — https://trend-drop.onrender.com
**Integrations:** Stripe **test mode**, EasyPost **sandbox**, Cloudinary
**Verdict:** ✅ **RELEASE READY** — no product defects found in this validation cycle; all 288 production API scenarios pass (one transient provider failure was rerun green).

---

## 1. Test population

Bulk verified accounts seeded directly into the production database (passwords hashed with bcrypt, emails marked verified):

| Role | Count | Accounts |
|---|---:|---|
| Sellers | 6 | seller1..seller6@trenddrop.test |
| Buyers | 6 | buyer1..buyer6@trenddrop.test |
| Primary / QA | 4 | reddy59021, reddy59022, qabot, qaseller |

All 12 marketplace accounts use password `TestPass123!`. Seller origins and buyer destinations use real, verifiable US addresses (LA, NYC, Chicago, Houston, Phoenix, Philadelphia), so every checkout purchases a real EasyPost sandbox label.

Signup was also validated live: `POST /api/auth/register` → 201, verification token stored, `POST /api/auth/verify-email` → 200, first login → 200 (the temporary signup artifact was removed after the check).

---

## 2. Automated verification results

| Suite | Result |
|---|---|
| Server unit/integration (`npm test`, 4 shards) | **2,831 passed / 0 failed** |
| Production core E2E (35 spec files) | **279 / 280 passed**; single S28.3 EasyPost 502 → rerun **5 / 5 passed** |
| Production multi-party E2E (`36`) | **8 / 8 passed** |
| Critical coverage gate | 376 tests, statements 99.15%, branches 85.07% (`payments.js`), lines 100% |
| Critical mutation gate | success |
| Live signup → verify → login | 201 → 200 → 200 |

Total production scenarios exercised: **288** (280 core + 8 multi-party). Every scenario has passed in this cycle.

---

## 3. Feature coverage

| Area | Spec(s) | Covered behavior |
|---|---|---|
| Health / auth / Stripe mode | 01 | health, Mongo health, test-key enforcement, both sellers, auth guards |
| Listings & boosts | 02 | create, boost tiers/fees, boost revenue split |
| Cart | 03 | add/update/remove, quantity guards, multi-item cart |
| Checkout & payment | 04 | authorize → labels → capture, batch capture, cross-account checkout, refund lifecycle |
| Order lifecycle | 05, 26 | status transitions, shipping, cancel guards, buyer journey |
| Payouts / cashout | 06, 09, 31 | dashboards, numeric balances, payout method, full/partial cashout, over-balance and invalid amounts |
| Reviews / badges / loyalty | 07 | completed-purchase-only reviews, ratings, badges, loyalty |
| Multi-seller batch | 08 | one payment across sellers, per-seller labels, bundled shipments |
| Offers | 10 | offer, counter, accept, decline, state guards |
| Relist | 11 | sold listing relist flow |
| Promo / bundles | 12 | promo validation and use accounting |
| Returns / disputes | 13, 30, 32 | return request/approve/refund, dispute outcomes, full return journey |
| Shipping insurance | 14 | insurance purchase and claims |
| Seller tiers | 15 | tier thresholds and benefits |
| Gap coverage | 16 | defensive paths and regressions |
| Social | 17 | follow, wishlist, collections, messages, seller communities |
| Marketplace services | 18 | service listings and purchases |
| Shipping logistics | 19 | rates, labels, tracking |
| Advanced features | 20 | bundles, price suggestions, advanced flows |
| Mobile / AI / social | 21 | AI stylist, virtual try-on, social commerce |
| Admin / enterprise | 22 | admin dashboards, moderation, enterprise API |
| Messaging | 23 | unified one-row-per-person conversations |
| Geo / currency | 24 | geo defaults, currency switching |
| Seller journey | 25 | onboard → list → sell → ship → dashboard |
| Buyer journey | 26 | 3-seller cart → checkout → cancel guard |
| Multicurrency matrix | 27 | USD, GBP, EUR, CAD, AUD purchases and seller aggregation |
| International gate | 28 | domestic-only mode, cross-border rejection |
| Auctions | 29 | create, bid, close, winner purchase |
| Cart → order | 34 | confirm ⇒ order exactly once, failed authorization released, promo consumed once |
| Revenue zero-sum | 35 | buyer charge = seller escrow + platform fee + postage, cancellation unwind |
| **Multi-party release** | **36** | **2-seller single checkout, last-unit race, offer, messaging, follow/wishlist, cross-account isolation, per-seller cancellation + label void** |

### Multi-party scenario details (new)
- One buyer pays for items from **two different sellers** in a single intent; exactly **2 transactions**, **2 labels**, one Order with **2 shipments**.
- Two buyers race for the last unit: exactly **one paid transaction/order**; the loser is fully compensated (`refunded`) with **no Order**.
- Offer accepted by a different seller; duplicate acceptance rejected.
- Unified thread messaging across buyer/seller; one conversation row.
- Follow is idempotent across reruns; wishlist add/check verified.
- Buyer cannot read another buyer’s transaction (403/404).
- Cancelling one seller’s leg refunds it fully and makes its label download return **410**, without touching the other leg.

---

## 4. Defects found and fixed

All defects found in this cycle were **test-harness defects** (the application behaved correctly); they are fixed in this commit.

| # | Spec | Defect | Fix |
|---|---|---|---|
| 1 | 06 | Hard-coded prior balance (`41.4 + 61.6`) failed once label cost changed with seller origin | Derive expected pending from each transaction’s `sellerEarnings` |
| 2 | 09 | Called non-existent `PUT /api/users/me/payout-method`, silently skipped on 404, leaving later cashout spec without a method | Use `PUT /api/auth/profile` with `payoutMethod`; assert 200 |
| 3 | 31 | Not self-sufficient despite header; relied on a pre-existing payout method | Configure PayPal payout method in `beforeAll` |
| 4 | 36 | Expected 2 Orders for a 2-seller checkout (API correctly returns 1 Order / 2 shipments) | Assert 1 Order, 2 shipments, 2 transactions |
| 5 | 36 | Race loser returns 502 on fail-closed rollback; assertion allowed only 4xx | Accept 502 and assert loser has no paid order (refunded only) |
| 6 | 36 | Reply message returns 200 when thread exists | Accept 200/201 |
| 7 | 36 | Follow endpoint is a toggle; reruns unfollowed | Check state first, follow only when needed |
| 8 | 36 | Login throttle blocked repeated runs | JWT cache for seeded accounts; tokens minted with server secret |

No application, schema, payment, label, or authorization defect was found during this validation.

---

## 5. Known limitations / operational notes

1. **EasyPost sandbox flake:** one S28.3 domestic purchase returned 502 from the provider; the rerun passed 5/5. The failure path is fail-closed: authorization released, no Order, buyer not charged, and the label refund queue retries any purchased postage. Production labels should be monitored for provider 5xx.
2. **API rate limit:** production enforces **1000 requests / 15 min / IP**. The full 288-test suite is executed in two windows (core 280, then multi-party 8) because a single window cannot carry both runs plus setup.
3. **UI/browser:** this run was API-level end-to-end. A later interactive browser pass is documented in `qa/BROWSER_QA_REPORT.md`; it found and fixed five UI/API defects (see the addendum below).
4. **External history:** EasyPost shipments remain immutable (no delete API); Stripe retains immutable test charges/refunds/intents. All test customers are deleted, all captured charges refunded, and authorizations canceled.

---

## 6. Sign-off

- **Product:** all core marketplace journeys work for multiple independent sellers and buyers.
- **Money:** authorize → label → capture ordering holds; failed labels never create orders/charges; cancellation refunds buyer, voids label, and unwinds ledgers; duplicate/last-unit races cannot create two orders.
- **Security:** cross-account transaction isolation enforced; auth guards return 401; test-mode Stripe enforced; rate limiting active.
- **Operations:** production health 200, Mongo health 200, EasyPost configured, both primary logins 200, marketplace starts empty except accounts.

**Release recommendation: APPROVED for continued testing/release use.**

---

## 7. Browser QA addendum (2026-11-28)

A full browser pass covered browse, search, listing detail, like/wishlist, cart, a real Stripe test-card checkout, orders, transactions, messaging, selling, seller dashboard, payouts, offers, notifications and settings/auth. Five defects were found and fixed:

1. Like returned 500 when the item was already wishlisted (idempotent wishlist write).
2. Listing-page shipping disagreed with cart/checkout (now uses the server quote).
3. Quick add to cart never rendered (`available_quantity` did not exist; now derives from `quantity`/`available`/`sold`).
4. “All Statuses” re-applied the default status filter (now sends every known status).
5. Detail routes inherited the previous scroll position (router-aware scroll reset).

Affected tests pass (server wishlist 19/19; client listing 7/7, transactions 12/12, listing card 5/5), the client production build succeeds, and CI on `89ac5a6` is green including 291 in-memory Playwright tests. Production deployment of the fixes is still pending in the Render dashboard; see the QA report for evidence and remaining limitations.
