# TrendDrop — Business Rules & Requirements

> **Purpose:** This document is the single source of truth and **exact codebase reflection**.
> Every rule here is verified by E2E tests.
> **Last Updated:** May 31, 2026 — v5.0 (5% platform fee, multi-currency revenue protection)

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
- **ListingDetail** shows real-time offer status badges: pending (⌛), countered (🔄 with Accept/Counter), buyer_countered (Awaiting seller...), accepted (✅ with Buy Now)
- **Offers page** shows appropriate actions per state: Accept/Counter/Decline for pending received, Accept/Counter/Decline for buyer_countered received, Accept/Counter for countered sent, "Awaiting seller" for buyer_countered sent, "Proceed to Purchase" for accepted sent

### Multi-Currency:
- Offer inherits the listing's currency on creation
- Currency mismatch between offer and listing is rejected with 400
- If no currency is provided, the listing's currency is used as default
- Notifications use the offer's currency symbol in messages

### Verified by Tests: SM.1-SM.8 (state machine), NT.1-NT.2 (full negotiation→transaction), AP.1-AP.4 (single acceptance paths), IT.1-IT.4 (invalid transitions), AU.1-AU.5 (authorization/edge), CV.1-CV.3 (currency), RP.1 (revenue protection) — 28 tests

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

### Payment Formulas (5% Platform Fee — UNIFORM across all countries):
```
Buyer Pays:
itemPrice              = listing price (or negotiated offer price)
shippingCost           = estimated carrier cost (pass-through)
buyerProtectionFee     = itemPrice × 5% (separate from platform fee)
totalPaid              = itemPrice + shippingCost + buyerProtectionFee

Seller Receives:
platformFee            = itemPrice × 5% (min $0.50, max $50 per country)
sellerEarnings         = itemPrice − platformFee (shipping passes through separately)
shippingPayout         = shippingCost (pass-through to seller, NOT commissioned)

Platform Revenue:
platformCommission     = platformFee (5% of item price only)
buyerProtectionFee     = 5% of item price (non-refundable on buyer remorse)
stripeFee              = ~2.9% + $0.30 of totalPaid (varies by country)
netRevenue             = commission + protectionFee − stripeFee

CRITICAL RULES:
- Commission is ALWAYS on item price ONLY — NEVER on totalPaid (which includes shipping + protection)
- This is verified by test BD.6 (commission < commission_if_calculated_on_totalPaid)
- All countries: 5% platform fee (Japan dropped from 12% to 5% to match global)
- Japan: minFee 50 JPY (~$0.33), maxFee 5000 JPY (~$33)
- $5 item US→US: netRevenue ~$0.13 (still positive)
- $5 item JP→US: netRevenue may be negative (stripe fee > revenue) — documented edge case
- Minimum price $5 mitigates loss; international small orders may still lose
```

### Verified by Tests: BD.1-BD.6 (breakdown), TF.1-TF.4 (transactions), PR.1-PR.2 (payouts), PA.1-PA.4 (profit), RL.1-RL.3 (loss prevention), MC.1-MC.7 (multi-currency) — 25 tests

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

### Verified by Tests: 5.1-5.10 (10 tests)

---

## 6. Shipping

### Code: `server/config/shipping.js`

- Calculated by zone (domestic < continental < intercontinental)
- Free shipping over $50 (domestic, under 0.5kg)
- Shipping cost pass-through to seller
- Available endpoints: calculate, carriers, countries, currencies, tracking

### Verified by Tests: 6.1-6.8 (8 tests)

---

## 7. Return Flow

- Buyer requests with reason + evidence within 5 days
- Seller accepts/rejects within 3 days
- Return shipping: seller pays if at fault, buyer pays if remorse
- On refund: buyer gets item price + shipping (protection fee: see 4.3)
- Full refund via Stripe, inventory restored

### Verified by Tests: 7.1-7.5 (5 tests)

---

## 8. Dispute Flow

- Requires reason AND evidence
- 48h response window
- `disputed` → `dispute_resolved`
- Funds held during dispute

### Verified by Tests: 8.1-8.2 (2 tests)

---

## 9. Payout & Commission

### Code: `server/routes/payouts.js`, `server/models/Payout.js`

- Commission: 5% of item price (min $0.50, max $50 per country)
- Payout records MUST use `paymentBreakdown.platformFee` — verified by tests
- Fallback formula in payouts.js uses `Math.round(salePrice * 0.05 * 100) / 100` (only used if breakdown missing)
- Auto-process skips refunded transactions
- Dashboard shows real aggregate totals
- Seller KYC required before first payout (planned)

### Verified by Tests: PR.1-PR.2 (payout records), SF.1-SF.2 (portfolio simulation), commission-info endpoint — 5 tests

---

## 10. Boost System

### Code: `server/config/boost.js`

- Tiers: standard (10%), premium (15%), elite (20%)
- **Fee is deducted from the seller's pending earnings when the boosted listing is sold** (non‑refundable after sale). If the buyer returns the item, the fee is effectively refunded because it never leaves the pending pool.
- Max 10 active boosts per seller
- Priority score = composite (likes × 2 + views × 0.5 + saves × 3 + sales × 10 + conversion × 50 − reports × 100)

### API: Boost Configuration
The client needs to know the boost tiers, fee percentages, and limits without hard‑coding them. A new endpoint `/api/boost/config` was added (see `server/routes/boost.js`). It returns the entire `boostConfig` object defined in `server/config/boost.js`, exposing:
```
{
  boostFeePercent,
  minDurationDays,
  maxDurationDays,
  defaultDurationDays,
  priorityMultiplier,
  maxActiveBoosts,
  tiers,
}
```
The frontend can fetch this via the newly added `getBoostConfig` helper in `client/src/services/api.js`.

---

## 11. Multi-Currency

- Listing price in seller's currency
- Buyer sees local price (converted)
- Exchange rate locked at authorization
- Stripe handles conversion
- Platform fee is always 5% of item price regardless of currency
- Buyer protection is 5% of item price regardless of currency
- Min/max fees are per-country (JPY min 50, max 5000; USD min $0.50, max $50)

---

## 12. Platform Fee Comparison

| Platform | Commission |
|----------|-----------|
| TrendDrop | 5% |
| Poshmark | 20% |
| Mercari | 10% |
| Depop | 10% |

---

## 13. Seller Strikes & Suspension

- Strike triggers: seller cancel, auto-cancel (not shipped 7 days), counterfeit
- 3 strikes = account suspension
- `stats.strikes` tracked in User model
- Verification tests: 5.5, 16.1

---

## 14. Notifications

- Types: like, follow, comment, offer, sale, share, purchase, shipping, review, seller_review, payout
- Read/unread tracking, mark-all-read endpoint

### Tests: 14.1-14.3 (3 tests)

---

## 15. Search & Feed

- Filters: category, brand, size, condition, price range, search
- Sorts: newest (default), price_low, price_high, popular
- Pagination: page + limit
- Feed shows active, unsold items with quantity > 0

### Tests: 15.1-15.6 (6 tests)

---

## 16. Messages

- One conversation per buyer-seller per listing
- Unread count; reply via conversation ID
- Empty text rejected
- Off-platform payment detection (planned)

### Tests: 16.1-16.5 (5 tests)

---

## 17. Reviews & Ratings

- 1-5 stars with optional text
- Both buyer and seller can review completed transactions
- Both-party-submit-then-publish prevents retaliation

### Tests: 17.1-17.4 (4 tests)

---

## 18. Chargeback Handling

- States: `chargeback_open` → `chargeback_won` / `chargeback_lost`
- Stripe webhook initiated
- Seller absorbs loss if at fault; negative balance supported
- Tests verify schema valid states (18.1)

---

## 19. Platform Safety

- API rate limit: 100 req/15min
- Auth rate limit: 20 req/15min
- Health endpoint: `/health`
- Stripe webhook: `/api/payments/webhook`

### Tests: EC.1-EC.10 (edge cases)

---

## 20. Revenue Protection (Critical — Verified by Tests)

This section is verified by 33 dedicated revenue flow tests:

### Payment Breakdown (BD.1-BD.6):
- **BD.1**: $100 US → $5 fee (5%), $95 seller, $5 protection, netRevenue > 0 ✓
- **BD.2**: $10 item: 5% = $0.50 (min fee applies) ✓
- **BD.3**: $5 minimum still profitable (US) ✓
- **BD.4**: $5000 item: 5% = $250, clamped to max $50 ✓
- **BD.5**: Japan 5% fee, JPY minFee 50 ✓
- **BD.6**: Commission NEVER on totalPaid (revenue critical) ✓

### Transaction Flow (TF.1-TF.4):
- **TF.1**: Full $100 transaction: breakdown matches 5% calculation ✓
- **TF.2**: Multiple quantity: cumulative revenue verified ✓
- **TF.3**: $5 minimum: platform still profitable ✓
- **TF.4**: Shipping pass-through verified ✓

### Payout Records (PR.1-PR.2):
- **PR.1**: Payout uses pre-calculated breakdown (NEVER recalculated from totalPaid) ✓
- **PR.2**: Payout API endpoint matches breakdown values ✓

### Profit Analysis (PA.1-PA.4):
- **PA.1**: Net revenue positive $5-$1000 ✓
- **PA.2**: US→GB still profitable ✓
- **PA.3**: Japan domestic profitable (5% fee) ✓
- **PA.4**: Platform revenue formula matches calculations ✓

### Seller Portfolio (SF.1-SF.2):
- **SF.1**: 5 items at different prices: total earnings = sum minus 5% commission ✓
- **SF.2**: Dashboard aggregates correct ✓

### Revenue Loss Prevention (RL.1-RL.3):
- **RL.1**: Seller never earns more than item price minus 5% fee ✓
- **RL.2**: Net revenue positive $10-$1000 across US/GB/JP ✓
- **RL.3**: $5 JP→US can lose money — documented edge case ✓

### Multi-Currency Revenue Protection (MC.1-MC.7) — NEW:
- **MC.1**: USD $200: 5% = $10 fee, $190 seller ✓
- **MC.2**: JPY ¥10000: 5% fee in JPY terms ✓
- **MC.3**: EUR €150: 5% = €7.50 ✓
- **MC.4**: Cross-border US→JP: 5% US seller fee, 5% JP buyer protection ✓
- **MC.5**: Cross-border GB→DE: 5% GB seller fee, 5% DE buyer protection ✓
- **MC.6**: Buyer pays totalPaid = itemPrice + shipping + 5% protection ✓
- **MC.7**: Seller earnings = itemPrice - platformFee (shipping passes through) ✓

### Total Test Count: 145 (112 e2e + 33 revenue)
- Core business flows: 112 tests covering rules 1-20
- Revenue simulation: 33 tests covering money flow edge cases (including 7 multi-currency tests)
- All pass against real MongoDB database

---

*This document exactly reflects the codebase at commit time. Every rule is test-verified.*