# TrendDrop Browser QA Report

**Date:** 2026-11-28
**Environment:** Production — https://trend-drop.onrender.com
**Release:** `7ae56d1` (fixes) on top of `854dff6`
**Accounts:** seeded buyer/seller test accounts only (`buyer1..6`, `seller1..6`, password `TestPass123!`)
**Payments/shipping:** Stripe test mode, EasyPost sandbox

## 1. Journeys exercised in a browser

| Area | What was validated | Result |
|---|---|---|
| Home / responsive shell | Desktop and mobile layout, nav, mobile tab bar, legal consent, no uncaught render error | Pass |
| Search | Query results, item count, sorting control, listing cards | Pass |
| Listing detail | Media/Cloudinary images, price, seller card, shipping estimator, purchase summary, comments, similar items | Pass |
| Like / wishlist | Like from card and detail page, wishlist page shows the item, remove from wishlist | Pass after fixes |
| Cart | Add, quantity, remove, item and order totals | Pass |
| Checkout | Stripe test card `4242 4242 4242 4242`, shipping address, empty-card validation, order confirmation | Pass |
| Real purchase | Order `#TD-870721`, total `$89.25`, USPS tracking `9434600208192110840985`, order page and transactions row | Pass |
| Transactions | All / Bought / Sold tabs, status dropdown, pagination, seller earnings breakdown | Pass after fixes |
| Messaging | Buyer → seller message, seller thread, seller reply (`POST /api/messages` 200) | Pass |
| Selling | Sell wizard: image upload → details → shipping → pricing → publish (`201`), listing visible in search/home | Pass |
| Seller dashboard | Sales/earnings/pending metrics, quick actions, tabs, commission comparison | Pass |
| Payout settings | Available/pending/total, test-payout notice, method selector | Pass |
| Offers | Buyer sends `$36` offer (`201`), seller sees it, declines it; status updates | Pass |
| Notifications | Seller sees sale and refund notifications, mark-all-read control | Pass |
| Settings/auth | Logout, buyer and seller login, profile fields | Pass |
| Navigation | Route changes reset scroll; “Back to Orders” reaches `/transactions` | Pass after fix |

Screenshots are in `qa/screenshots/` (desktop and mobile, including checkout, order detail, transactions and seller dashboard). They are local QA evidence and are not committed.

## 2. Defects found and fixed

### 2.1 Like returned 500 when the item was already wishlisted
- **Symptom:** clicking Like on an already-wishlisted listing returned `POST /api/listings/:id/like` 500 while the UI optimistically showed success.
- **Cause:** the like route wrote a filtered wishlist upsert (`items.listing != id` + `upsert`). When the item was already present the filter missed, so Mongo tried to insert a second wishlist document for the same unique user.
- **Fix:** ensure the wishlist document exists with `$setOnInsert`, ignore a concurrent `E11000`, then push only when the listing is absent. The client now calls only the like endpoint and trusts its `liked`/`likes` response.
- **Regression test:** `server/tests/wishlist.test.js` “Like succeeds and keeps a single wishlist row when already wishlisted”.

### 2.2 Listing page quoted different shipping than cart/checkout
- **Symptom:** a $85 listing showed `$93.24` on the detail page ($3.99 shipping) while cart and checkout charged `$89.25` with free US shipping over $50.
- **Cause:** the purchase summary used `listing.shipping.shippingCost` and ignored the server’s weight/threshold calculation.
- **Fix:** fetch `/shipping/calculate` for the displayed price and destination and use its `cost` in the summary. The static value remains only as a fallback if the quote fails.
- **Tests:** `client/src/pages/__tests__/ListingDetail.test.js` (7/7) including the server contract and item-price fields.

### 2.3 Quick add to cart was permanently hidden
- **Symptom:** no quick-add button appeared on listing cards; adding from a card also had no real quantity limit.
- **Cause:** `ListingCard` read a field that does not exist (`available_quantity`); the condition `undefined > 0` was always false.
- **Fix:** derive availability from `quantity`, `available` and `sold`, show quick add for available listings, and pass the real quantity into the cart. Sold/unavailable listings hide the button.
- **Tests:** `client/src/components/__tests__/ListingCard.test.js` (5/5), including quantity propagation and the sold case.

### 2.4 “All Statuses” silently re-applied the default filter
- **Symptom:** on the Sold tab, choosing “All Statuses” still returned zero orders while the All tab showed 28 seller transactions.
- **Cause:** the explicit all-status state was `[]`; the client omitted the `status` parameter, so the server re-applied its `paid,processing` default.
- **Fix:** send every known status when “All Statuses” is selected; default Sold behavior (ready to ship) is unchanged.
- **Tests:** `client/src/pages/__tests__/Transactions.test.js` (12/12).

### 2.5 Detail routes inherited the previous page’s scroll position
- **Symptom:** opening a listing from a scrolled search page landed mid-listing.
- **Fix:** a router-aware `ScrollToTop` resets scroll on pathname changes.

## 3. Verification run

| Check | Result |
|---|---|
| `server/tests/wishlist.test.js` | 19/19 pass |
| `ListingDetail.test.js` | 7/7 pass |
| `Transactions.test.js` | 12/12 pass |
| `ListingCard.test.js` | 5/5 pass |
| Client production build (`CI=false npm run build`) | Success |
| Prior API release suite | 279/280 core + multi-party 5/5 (see `RELEASE_SIGNOFF.md`) |

## 4. Remaining limitations and observations

1. **EasyPost sandbox tracker reuse:** the newly purchased sandbox label immediately reported October 30 tracking events. The transaction moved to `delivered` while its Order shipment stayed `pending` and the order header stayed `Confirmed`. This is sandbox tracker data, not a normal production label; the UI can therefore show “Delivered” on the item and “Pending” on tracking for sandbox purchases.
2. **Sold tab default:** “Sold” intentionally defaults to `paid,processing` (“ready to ship”). Delivered/refunded sales require “All Statuses”. The label is arguably narrower than the tab name.
3. **Cart replay noise:** a stale persisted cart item replays on load and receives 400/404; the client catches it and the cart still renders. It produces console noise but no user-facing failure.
4. **Stripe iframe automation:** the browser preview tools cannot type into Stripe’s cross-origin card iframe, so the successful card payment was completed with a short Playwright script against the same production UI.
5. **UI checks are not exhaustive:** admin-only screens, auction UI, native app builds and every review/return branch were not driven end to end in this browser pass; their API coverage remains in the release suite.

## 5. Deployment status

- Fixes: `7ae56d1`, plus the CI-only skip in `89ac5a6`, pushed to `main`.
- CI on `89ac5a6`: server suite, client unit tests, production build and in-memory Playwright suite all succeeded (291 passed, 8 production-only multi-party tests skipped).
- **Production still serves the previous bundle** (`main.cdfb6370.js`). No deploy followed the green CI run, and the Render dashboard is signed out on this machine, so the latest commit could not be released from this session. Deploy `89ac5a6` from the Render dashboard to publish the fixes.
- The fixes themselves were validated in the local production build backed by the in-memory E2E server: quick-add buttons render, a $129 listing quotes `$0.00` shipping and `$135.45` total, Like toggles cleanly, “All Statuses” requests the full status list, and detail routes open at scroll position 0.
