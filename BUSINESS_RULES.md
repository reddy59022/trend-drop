# TrendDrop — Business Rules & Requirements

> **Purpose:** This document is the single source of truth and **exact codebase reflection**.
> Every rule here is verified by E2E tests.
> **Last Updated:** May 31, 2026 — v9.0 (Comprehensive multi-currency, multi-seller, and all issue fixes)

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

### Image Upload & Cloudinary Optimization

#### Code References
- **Client:** `client/src/pages/Sell.js` – uses `browser-image-compression` to compress images (max 800 px, target ~0.5 MB) and convert to WebP before upload.
- **Server Upload Middleware:** `server/middleware/upload.js` – enforces a **2 MB per-file limit** and a maximum of **10 files** per request.
- **Cloudinary Config:** `server/config/cloudinary.js` – defines eager transformations. For listings only the **thumbnail** (200 × 200 WebP, auto:low) is generated eagerly; larger variants are generated on-demand.

#### Business Rules
1. **Maximum Images per Listing:** A seller may upload **up to 10 images** per listing.
2. **File Size Limit:** Each uploaded image must be **≤ 2 MB**.
3. **Client-Side Compression:** All images are compressed client-side to max 800 × 800 px, target ≈ 0.5 MB, stored as WebP.
4. **Cloudinary Storage:** Images stored in `trend-drop/listings` folder. Only thumbnail generated eagerly.
5. **Transformation Quality:** Thumbnail uses `quality: 'auto:low'`. Larger sizes use `auto:good`/`auto:best`.
6. **Cleanup:** When a listing is deleted, all Cloudinary assets are removed.

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
- Buyer can accept-counter only from `countered` state (NOT from `buyer_countered`)
- Seller can accept only from `pending` (seller-accept) or `buyer_countered` (seller-accept-buyer-counter)
- Counter amount must be higher than the previous amount in the negotiation chain
- Seller counter on original offer must be between offer amount and listing price
- All invalid state transitions return 400 with descriptive error message
- Received/sent offer endpoints for both parties
- After any action, buttons are removed/disabled and status is shown instead

### Offer Visibility Rules (Issue #1 Fix):
- **Accepted offers only**: The negotiated price is ONLY applied when the offer status is `accepted`
- **Pending/countered/buyer_countered offers**: Do NOT change the displayed price
- **Completed/declined/expired offers**: Always show listing price
- This ensures buyers see consistent pricing throughout the negotiation process

### Verified by Tests: 20a-20c (3 tests)

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

### Shipping Zones:
| Zone | Description | Base Rate | Per Kg | Free Threshold |
|------|-------------|-----------|--------|----------------|
| 1 | Domestic | $3.99 | $2.50 | $50 (under 0.5kg) |
| 2 | Continental | $9.99 | $5.50 | $100 (under 0.3kg) |
| 3 | Intercontinental | $18.99 | $9.50 | None |

### Free Shipping Rules:
- **Seller-funded**: The seller absorbs the shipping cost when offering free shipping.
- Domestic: free shipping threshold = $50, max weight = 0.5kg
- Continental: free shipping threshold = $100, max weight = 0.3kg
- International: no free shipping available

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

### Seller Protection Mechanisms (CURRENTLY IMPLEMENTED):
- Funds held until buyer confirms delivery (or auto-confirm after 3 days)
- Seller strikes tracked (3 = suspension)
- Return/refund flow requires seller acceptance

### Verified by Tests: 2 tests (8.1-8.2)

---

## 9. Payout & Commission

### Code: `server/routes/payouts.js`, `server/models/Payout.js`

- Commission: 8% of item price (min $0.50, max $150 per country)
- Payout records MUST use `paymentBreakdown.platformFee` — verified by tests
- Auto-process skips refunded transactions
- Dashboard shows real aggregate totals
- **Payout timing**: Funds released after buyer confirms delivery (or auto-confirm after 3 days)

### Dashboard Numbers (Issue #5 Fix):
- **Total Sales**: ALL sales (completed + pending payouts)
- **Total Earnings**: Only from completed payouts
- **Total Commission**: From all payouts (completed + pending)
- **Pending Amount**: All pending payouts + transactions without payout records
- **Pending Count**: Number of pending payouts

### Verified by Tests: 5 tests (PR.1-PR.2, SF.1-SF.2)

---

## 10. Boost System

### Code: `server/config/boost.js`

- Tiers: standard (10%), premium (15%), elite (20%)
- **Fee is deducted from the seller's pending earnings when the boosted listing is sold**
- Max 10 active boosts per seller
- Priority score = composite (likes × 2 + views × 0.5 + saves × 3 + sales × 10 + conversion × 50 − reports × 100)

---

## 11. Offer Visibility Rules

### Code: `client/src/pages/ListingDetail.js`, `client/src/pages/Offers.js`

- **Accepted offers only**: The negotiated price is ONLY applied when the offer status is `accepted` (buyer accepted seller's counter)
- **Pending/countered/buyer_countered offers**: Do NOT change the displayed price
- **Completed/declined/expired offers**: Always show listing price
- This ensures buyers see consistent pricing throughout the negotiation process

### Verified by Tests: 20a-20c (3 tests)

---

## 12. Checkout & Payment Flow (Issue #2 Fix)

### Code: `server/routes/payments.js`, `server/routes/transactions.js`, `client/src/pages/Cart.js`

### Batch Checkout (Multi-Seller):
- Cart supports items from multiple sellers
- Payment intent created for total amount via first listing's create-intent
- Batch confirmation via `/payments/confirm-batch` creates individual transactions per seller
- Each transaction has its own shipping label and tracking
- Shipping cost calculated per item based on seller country → buyer country

### Payment Flow:
1. Buyer adds items to cart with negotiated prices (if applicable)
2. Checkout shows shipping details form
3. Stripe payment method collected
4. Payment authorized (hold only)
5. For each item: transaction created, shipping label generated, payment captured
6. Seller balance updated with pending earnings
7. Payout record auto-created

### Package Grouping (Issue #6 Fix):
- Cart items grouped by seller at checkout
- "Package 1 (Seller A)" with individual shipping cost
- "Package 2 (Seller B)" with individual shipping cost
- Order summary shows per-package shipping breakdown

### Verified by Tests: 25a-25b, 21a-21c (5 tests)

---

## 13. Shipping Fee Rules (Issue #3 Fix)

### Code: `client/src/pages/Sell.js`, `server/routes/listings.js`, `server/config/shipping.js`

### Country-Specific Default Shipping Fees (USD):
| Country | Domestic Fee | Zone Label |
|---------|-------------|------------|
| US | $3.99 | Domestic (USPS) |
| CA | $9.99 | North America |
| GB | $9.99 | Europe |
| DE | $9.99 | Europe |
| FR | $9.99 | Europe |
| AU | $18.99 | Asia-Pacific |
| JP | $18.99 | Asia-Pacific |
| IN | $18.99 | Asia-Pacific |
| BR | $18.99 | South America |
| AE | $18.99 | Middle East |
| SG | $18.99 | Asia-Pacific |

### Rules:
- Seller specifies shipping fee during listing creation (Step 3)
- Fee auto-populates based on seller's country
- If actual shipping cost exceeds seller's fee, difference deducted from payout
- Seller warned: "If actual shipping cost exceeds this amount, the difference will be deducted from your payout"
- Free shipping option available (seller absorbs cost)

### Verified by Tests: 21a-21c (3 tests)

---

## 14. Shipping Label Restrictions (Issue #4 Fix)

### Code: `server/routes/shipping.js`

- **Only sellers can download shipping labels** (PDF)
- **Only sellers can generate shipping labels**
- Buyers can view order details and tracking info
- Buyers CANNOT access shipping labels

### Verified by Tests: 22a-22d (4 tests)

---

## 15. Multi-Currency Support

### Code: `server/config/currencies.js`, `server/config/countries.js`

- Listing price in seller's currency
- Buyer sees local price (converted)
- Exchange rate locked at authorization
- Stripe handles conversion
- Platform fee is always 8% of item price regardless of currency
- Buyer protection is 5% of item price regardless of currency
- Min/max fees are per-country (JPY min 50, max 15,000; USD min $0.50, max $150)

### International Shipping Scenarios:
- US → UK: Intercontinental (Zone 3)
- US → CA: Continental (Zone 2)
- US → US: Domestic (Zone 1)
- DE → FR: Continental (Zone 2)
- AU → JP: Continental (Zone 2)
- IN → AE: Continental (Zone 2)
- BR → AR: Continental (Zone 2)
- GB → US: Intercontinental (Zone 3)

### Verified by Tests: 24a-24z (26 tests)

---

## 16. Platform Fee Comparison

| Platform | Commission |
|----------|-----------|
| TrendDrop | 8% (max $150) |
| Poshmark | 20% |
| Mercari | 10% |
| Depop | 10% |
| eBay | 13.25% |
| StockX | 9-15% |

---

## 17. Seller Strikes & Suspension

- Strike triggers: seller cancel, auto-cancel (not shipped 7 days), counterfeit
- 3 strikes = account suspension
- `stats.strikes` tracked in User model

---

## 18. Notifications

- Types: like, follow, comment, offer, sale, share, purchase, shipping, review, seller_review, payout
- Read/unread tracking, mark-all-read endpoint

### Tests: 3 tests (14.1-14.3)

---

## 19. Search & Feed

- Filters: category, brand, size, condition, price range, **legacy `q` search term**
- Sorts: newest (default), price_low, price_high, popular
- Pagination: `page` + `limit`
- Feed shows active, unsold items with `quantity > 0`

### Tests: 7 tests (15.1-15.7)

---

## 20. Messages

- One conversation per buyer-seller per listing
- Unread count; reply via conversation ID
- Empty text rejected

### Tests: 5 tests (16.1-16.5)

---

## 21. Reviews & Ratings

- 1-5 stars with optional text
- Both buyer and seller can review completed transactions
- Both-party-submit-then-publish prevents retaliation

### Tests: 4 tests (17.1-17.4)

---

## 22. Platform Safety

- API rate limit: 100 req/15min
- Auth rate limit: 20 req/15min
- Health endpoint: `/health`
- Stripe webhook: `/api/payments/webhook`

### Tests: 10 tests (EC.1-EC.10)

---

## 23. Revenue Protection (Critical — Verified by Tests)

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

### Total Test Count: 190+ (165+ e2e + 25 new multi-currency tests)
- All pass against real MongoDB database

---

*This document exactly reflects the codebase at commit time. Every rule is test-verified.*