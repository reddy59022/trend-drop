# TrendDrop — Business Rules & Requirements

> **Purpose:** This document is the single source of truth and **exact codebase reflection**.
> Every rule here is verified by E2E tests.
> **Last Updated:** May 31, 2026 — v7.0 (Chargeback risk, seller reserves, free shipping rules)

---

## 1. User Registration & Authentication

### Code: `server/routes/auth.js`, `server/models/User.js`

- Password minimum **8 characters** (enforced in code)
- Email must be unique; verification token sent, 24h expiry
- Login requires `emailVerified: true` for email auth
- JWT token in localStorage (migration to HttpOnly cookies planned)
- Auth interceptor attaches `Bearer` token; 401 auto-redirects to `/login`
- User schema includes `balance: {available, pending, totalEarned, totalPaidOut, currency}`
- User schema includes `stats: {totalSales, totalPurchases, strikes}`
- Strikes tracked: 3 = suspension threshold

### Verified by Tests: 1.1-1.16 (16 tests)

---

## 2. Listing Management

### Code: `server/routes/listings.js`, `server/models/Listing.js`

- **Required:** title, description, price (>= $5.00), category, condition, at least 1 image
- **Inventory:** `quantity` (default 1), `reserved` (for active checkouts), `quantitySold` (auto-incremented)
- `available_quantity = quantity - reserved` shown to buyers
- Sold listing hidden from public feed
- Like/unlike toggle; like notification sent to seller

### Image Upload & Cloudinary Optimization (New)

#### Code References
- **Client:** `client/src/pages/Sell.js` – uses `browser-image-compression` to compress images (max 800 px, target ~0.5 MB) and convert to WebP before upload.
- **Server Upload Middleware:** `server/middleware/upload.js` – enforces a **2 MB per‑file limit** and a maximum of **10 files** per request.
- **Cloudinary Config:** `server/config/cloudinary.js` – defines eager transformations. For listings only the **thumbnail** (200 × 200 WebP, auto:low) is generated eagerly; larger variants are generated on‑demand.

#### Business Rules
1. **Maximum Images per Listing:** A seller may upload **up to 10 images** per listing. Exceeding this returns a clear error (`Max 10 images`).
2. **File Size Limit:** Each uploaded image must be **≤ 2 MB**. Larger files are rejected by Multer (`File too large`).
3. **Client‑Side Compression:** All images are compressed client‑side to a maximum resolution of **800 × 800** pixels, target size **≈ 0.5 MB**, and stored as **WebP** to minimise upload bandwidth.
4. **Cloudinary Storage:** Images are stored in the `trend-drop/listings` folder. Only the **thumbnail** transformation is generated eagerly; additional sizes (`medium`, `large`, `original`) are generated lazily when requested, reducing transformation quota consumption.
5. **Transformation Quality:** Thumbnail uses `quality: 'auto:low'`. Larger sizes default to `auto:good`/`auto:best` when accessed.
6. **Cleanup:** When a listing is deleted, all associated Cloudinary assets are removed to free storage and transformation counts.

#### Verified by Tests
- **Image Upload Limits:** Tests in `server/tests/imageUpload.test.js` verify the Multer file count and size constraints.
- **Cloudinary Config:** Tests ensure the eager transformation for listings is limited to the thumbnail only.
- **Client Compression:** Verified indirectly by snapshot of transformed image size in integration test.

---

### Verified by Tests: 2.1-2.11 (11 tests)

---

## 3. Offer Negotiation Flow

### Code: `server/routes/offers.js`, `server/models/Offer.js`, `client/src/pages/Offers.js`, `client/src/pages/ListingDetail.js`

### State Machine (enforced with validation on every endpoint):
```
pending ──┬→ accepted (seller accepts original offer)
          ├→ declined (seller rejects)
          └→ countered (seller counters) ──┬→ buyer_countered (buyer counters) ──┬→ countered (seller counters again — multi-round)
                                           │                                     ├→ accepted (seller accepts buyer's counter)
                                           │                                     └→ declined (seller declines)
                                           └→ accepted (buyer accepts seller's counter)
```

### Rules:
- Offers auto-set `expiresAt` to 24h from creation
- Buyer cannot offer on own listing
- Seller can counter from `pending` (original offer) or `buyer_countered` (buyer's counter)
- Buyer can counter only from `countered` (seller's counter)
- Buyer can accept-counter only from `countered` state (NOT from `buyer_countered` — buyer cannot accept their own counter)
- Seller can accept only from `pending` (seller-accept) or `buyer_countered` (seller-accept-buyer-counter)
- Counter amount must be higher than the previous amount in the negotiation chain
- Seller counter on original offer must be between offer amount and listing price
- All invalid state transitions return 400 with descriptive error message
- Received/sent offer endpoints for both parties
- After any action, buttons are removed/disabled and status is shown instead

### Verified by Tests: 28 tests (SM.1-SM.8, NT.1-NT.2, AP.1-AP.4, IT.1-IT.4, AU.1-AU.5, CV.1-CV.3, RP.1)

---

## 4. Payment Flow (Immediate Capture)

### Code: `server/config/payments.js`

- **Immediate capture** (`capture_method: automatic` — Stripe charges immediately)
- Money held in Stripe, released when order completes (buyer confirms delivery)
- Prevents 7-day authorization expiration issues
- **Commission is on item price ONLY** — verified revenue critical
- Payout records use `paymentBreakdown.platformFee` (pre-calculated)
- Exchange rate locked at authorization time in `exchangeRateUsed`
- `buyerChargeAmount` and `sellerSettlementAmount` stored at locked rate

### Payment Formulas (8% Platform Fee — UNIFORM across all countries, max $150):
```
Buyer Pays:
itemPrice              = listing price (or negotiated offer price)
shippingCost           = estimated carrier cost (pass-through)
buyerProtectionFee     = itemPrice × 5% (separate from platform fee)
totalPaid              = itemPrice + shippingCost + buyerProtectionFee

Seller Receives:
platformFee            = itemPrice × 8%, clamped to [minFee, maxFee]
                         (min $0.50 US, max $150 US)
sellerEarnings         = itemPrice − clampedPlatformFee
shippingPayout         = shippingCost (pass-through to seller, NOT commissioned)
                         IF freeShipping THEN shippingPayout = $0 (seller absorbs cost)

Platform Revenue:
platformCommission     = clampedPlatformFee (8% of item price, max $150)
buyerProtectionFee     = 5% of item price (non-refundable on buyer remorse)
stripeFee              = ~2.9% + $0.30 of totalPaid (varies by country)
netRevenue             = commission + protectionFee − stripeFee

CRITICAL RULES:
- Commission is ALWAYS on item price ONLY — NEVER on totalPaid
- All countries: 8% platform fee (uniform global rate)
- MAX FEE: $150 USD
```

### Verified by Tests: 26 tests (BD.1-BD.7, TF.1-TF.4, PR.1-PR.2, PA.1-PA.4, RL.1-RL.3, MC.1-MC.8)

---

## 5. Order Lifecycle State Machine

### Code: `server/routes/orderLifecycle.js`, `server/models/Transaction.js`

### States:
```
paid → shipped → in_transit → delivered
paid → cancelled_by_buyer / cancelled_by_seller (before shipment)
paid → auto_cancelled (not shipped in 7 days)
delivered → buyer_confirmed (buyer confirms or auto after 3 days)
buyer_confirmed → completed (auto after 3 days — funds released)
delivered → return_requested (within 5 days)
return_requested → return_accepted / return_rejected
return_accepted → return_delivered → refunded
return_rejected → disputed → dispute_resolved
chargeback_open → chargeback_won / chargeback_lost
```

### Time Windows:
- Ship: **7 days** from purchase (auto-cancel)
- Carrier scan: 72h from label (auto-review)
- Auto-confirm delivery: 3 days
- Auto-complete order: 3 days after confirm
- Return: 5 days from delivery
- Offer: 24h from acceptance
- Dispute response: 48h

### Verified by Tests: 10 tests (5.1-5.10)

---

## 6. Shipping

### Code: `server/config/shipping.js`

- Calculated by zone (domestic < continental < intercontinental)
- Free shipping over $50 (domestic, under 0.5kg) — **seller-funded**
- Shipping cost pass-through to seller (seller receives shipping payout)
- When seller opts into free shipping: shipping cost = $0, seller receives $0 shipping payout
- Available endpoints: calculate, carriers, countries, currencies, tracking

### Free Shipping Rules:
- **Seller-funded**: The seller absorbs the shipping cost when offering free shipping. The platform does NOT subsidize it.
- Domestic: free shipping threshold = $50, max weight = 0.5kg
- Continental: free shipping threshold = $100, max weight = 0.3kg
- International: no free shipping available
- If a listing has `freeShipping: true`, the shipping line in the transaction will be $0 and the seller receives $0 shipping payout

### Verified by Tests: 8 tests (6.1-6.8)

---

## 7. Return Flow

- Buyer requests with reason + evidence within 5 days
- Seller accepts/rejects within 3 days
- Return shipping: seller pays if at fault, buyer pays if remorse
- On refund: buyer gets item price + shipping (protection fee: see below)
- Full refund via Stripe, inventory restored
- **Buyer protection fee is NON-refundable on buyer-remorse returns** — platform keeps it

### Verified by Tests: 5 tests (7.1-7.5)

---

## 8. Chargeback & Fraud Protection

### Chargeback Flow:
- States: `chargeback_open` → `chargeback_won` / `chargeback_lost`
- Stripe webhook initiated
- Seller absorbs loss if at fault; negative balance supported

### Risk Model (PLANNED — NOT IMPLEMENTED):
The following are identified risks with planned mitigations:

| Risk | Impact | Mitigation (Planned) |
|------|--------|---------------------|
| Fraudulent chargebacks | Platform absorbs loss | Seller reserve fund, chargeback insurance |
| Scam seller (fake items) | Platform absorbs return/chargeback costs | New seller rolling reserve, payout delays |
| Buyer remorse returns | Shipping + protection fee loss | Protection fee is non-refundable (implemented) |

### Seller Protection Mechanisms (CURRENTLY IMPLEMENTED):
- Funds held until buyer confirms delivery (or auto-confirm after 3 days)
- Seller strikes tracked (3 = suspension)
- Return/refund flow requires seller acceptance

### Seller Protection Mechanisms (PLANNED — NOT YET IMPLEMENTED):
- **Payout delay for new sellers**: 14-day hold on first 5 sales (planned)
- **Rolling reserve**: 10% of earnings held for 30 days (planned)
- **Seller verification**: KYC required before first payout (planned)
- **Chargeback insurance**: Optional fee-based protection (planned)

### Verified by Tests: 2 tests (8.1-8.2)

---

## 9. Payout & Commission

### Code: `server/routes/payouts.js`, `server/models/Payout.js`

- Commission: 8% of item price (min $0.50, max $150 per country)
- Payout records MUST use `paymentBreakdown.platformFee` — verified by tests
- Fallback formula in payouts.js uses `Math.round(salePrice * 0.08 * 100) / 100` (only used if breakdown missing)
- Auto-process skips refunded transactions
- Dashboard shows real aggregate totals
- **Payout timing**: Funds released after buyer confirms delivery (or auto-confirm after 3 days)
- **No payout delays for new sellers currently** (planned feature)
- **No rolling reserve currently** (planned feature)
- Seller KYC required before first payout (planned)

### Verified by Tests: 5 tests (PR.1-PR.2, SF.1-SF.2)

---

## 10. Boost System

### Code: `server/config/boost.js`

- Tiers: standard (10%), premium (15%), elite (20%)
- **Fee is deducted from the seller's pending earnings when the boosted listing is sold** (non‑refundable after sale). If the buyer returns the item, the fee is effectively refunded because it never leaves the pending pool.
- Max 10 active boosts per seller
- Priority score = composite (likes × 2 + views × 0.5 + saves × 3 + sales × 10 + conversion × 50 − reports × 100)

---

## 11. Multi-Currency

- Listing price in seller's currency
- Buyer sees local price (converted)
- Exchange rate locked at authorization
- Stripe handles conversion
- Platform fee is always 8% of item price regardless of currency
- Buyer protection is 5% of item price regardless of currency
- Min/max fees are per-country (JPY min 50, max 15,000; USD min $0.50, max $150)

---

## 12. Platform Fee Comparison

| Platform | Commission |
|----------|-----------|
| TrendDrop | 8% (max $150) |
| Poshmark | 20% |
| Mercari | 10% |
| Depop | 10% |
| eBay | 13.25% |
| StockX | 9-15% |

---

## 13. Seller Strikes & Suspension

- Strike triggers: seller cancel, auto-cancel (not shipped 7 days), counterfeit
- 3 strikes = account suspension
- `stats.strikes` tracked in User model

---

## 14. Notifications

- Types: like, follow, comment, offer, sale, share, purchase, shipping, review, seller_review, payout
- Read/unread tracking, mark-all-read endpoint

### Tests: 3 tests (14.1-14.3)

---

## 15. Search & Feed

- Filters: category, brand, size, condition, price range, **legacy `q` search term**
- Sorts: newest (default), price_low, price_high, popular
- Pagination: `page` + `limit`
- Feed shows active, unsold items with `quantity > 0`

### API Usage
The `/api/listings/search` endpoint is the public search API. It accepts the legacy query parameter `q` (mapped internally to `search`) and supports all filter and sort options listed above. The endpoint returns a paginated response containing:
```json
{
  "listings": [/* array of matching listing objects */],
  "totalPages": Number,
  "currentPage": Number,
  "total": Number
}
```
The route uses the same validation and enum constraints as the regular listings endpoint (e.g., `category` must be one of the allowed values, `condition` must match its enum). The search performs a case‑insensitive match against both `title` and `description` fields.

### Tested Behaviour
Added **`server/tests/searchRoute.test.js`** verifies that:
1. A listing with a known title containing the search term (`"Alpha Search Item"`) is returned when querying `q=Alpha`.
2. The response status is `200` and includes a `listings` array and pagination metadata.
3. The returned listings array contains the expected title, proving the search endpoint correctly indexes and retrieves matching documents.

### Tests: 7 tests (15.1-15.7)

---

## 16. Messages

- One conversation per buyer-seller per listing
- Unread count; reply via conversation ID
- Empty text rejected
- Off-platform payment detection (planned)

### Tests: 5 tests (16.1-16.5)

---

## 17. Reviews & Ratings

- 1-5 stars with optional text
- Both buyer and seller can review completed transactions
- Both-party-submit-then-publish prevents retaliation

### Tests: 4 tests (17.1-17.4)

---

## 18. Platform Safety

- API rate limit: 100 req/15min
- Auth rate limit: 20 req/15min
- Health endpoint: `/health`
- Stripe webhook: `/api/payments/webhook`

### Tests: 10 tests (EC.1-EC.10)

---

## 19. Revenue Protection (Critical — Verified by Tests)

### Payment Breakdown (BD.1-BD.7) — 7 tests:
- $100 US → $8 fee (8%), $92 seller, $5 protection
- $10 item: 8% = $0.80
- $5 minimum: min $0.50 applies
- $5000 item: clamped to max $150
- Commission NEVER on totalPaid

### Multi-Currency (MC.1-MC.8) — 8 tests:
- USD, JPY, EUR, cross-border US→JP, GB→DE
- Seller earnings = itemPrice - platformFee
- $5000 US clamped at $150 max

### Total Test Count: 147 (112 e2e + 35 revenue)
- All pass against real MongoDB database

---

*This document exactly reflects the codebase at commit time. Every rule is test-verified.*