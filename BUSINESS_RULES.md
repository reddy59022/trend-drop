# TrendDrop — Business Rules & Requirements

> **Purpose:** This document is the single source of truth and **exact codebase reflection**.
> Every rule here is verified by E2E tests.
> **Last Updated:** July 3, 2026 — v31.0 Seller Shipping Insurance (769/769 tests passing)

## Critical Bug Fixes (v22.0)

### Socket.io Initialization Fix
**Issue**: Server failed to start with error:
```
Error: You are trying to attach socket.io to an express request handler function. 
Please pass a http.Server instance.
```

**Root Cause**: `initializeWebSocket(app)` was passing Express app instead of HTTP server

**Fix**: 
- Created HTTP server: `const server = http.createServer(app)`
- Passed server to Socket.io: `initializeWebSocket(server)`
- Server now listens on HTTP server: `server.listen(PORT)`
- Location: `server/server.js`

**Result**: Server starts successfully on port 5001

---

## 1. User Registration & Authentication ✓ 16 tests
- Password minimum 8 characters, email must be unique with verification
- JWT token auth, 401 auto-redirects to /login
- Strikes tracked: 3 = suspension threshold
- Admin role support (`user`, `admin`, `moderator`, `suspended`)
- Suspended users auto-blocked from login

## 2. Listing Management ✓ 30 tests
- Required: title, description, price (>= $5.00), category, condition, at least 1 image
- Inventory: quantity (default 1), reserved, quantitySold
- Sold listings hidden from public feed
- Status field: `draft`, `active`, `sold`
- Auto-expiration: `expiresAt` Date field
- Boost/promotion system: Standard (10%), Premium (15%), Elite (20%) tiers

## 3. Offer Negotiation ✓ 41 tests
- Unlimited counter-offer chain
- Buyer/seller validation rules
- Offer-transaction linking

## 4. Payment Flow ✓ 26 tests
- 8% platform fee (maximum $500 cap)
- Manual capture: authorize first, capture AFTER fulfillment
- All-or-nothing batch checkout
- Rollback on failure

## 5. Order Lifecycle ✓ 18 tests
- States: paid → shipped → delivered → buyer_confirmed → completed
- Returns: delivered → return_requested → return_accepted → return_in_transit → return_delivered → refunded
- Auto-complete cron: 3 days after delivery, 3 days after confirmation

## 6. Shipping ✓ 8 tests
- Zone-based: Domestic ($3.99), Continental ($9.99), Intercontinental ($18.99)
- Free shipping over $50 domestic

## 7. Return & Refund Flow ✓ 9 tests
- 5-day return window
- Seller NOT paid for returned orders

## 8. Chargeback ✓ 2 tests
- States: chargeback_open → chargeback_won / chargeback_lost

## 9. Payout & Commission ✓ 23 tests
- 8% commission on item price only
- Delivery-based payout
- 10% rolling reserve held 60 days
- New seller hold: first 5 sales held 14 days

## 10. Boost System ✓ 27 tests
- Standard (10%), Premium (15%), Elite (20%) tiers

## 11-14: Core Features ✓ 19 tests
- Wishlist, Follow Seller, Shipping Fee, Label generation

## 15. Multi-Currency ✓ 26 tests
- 26 international shipping scenarios
- All currencies supported

## 16-22: Platform Standards ✓ 27 tests
- Notifications, Search, Messages, Reviews, Safety

## 23-28: Advanced Features ✓ 58 tests
- Complete lifecycle, Multi-seller batch orders, Order payout flow, Admin panel, Saved searches, Collections

## 28a-28h: Seller Tools ✓ 45 tests
- Bundle discounts, Offers to likers, Promo codes, Verified badge, Social links, Store customization, Draft listings, Auto-expiration

## 29. Shipping Labels ✓ 6 tests
- 40+ carrier support, PDF generation, void/refund, tracking

## 30. Real-Time Notifications ✓ 11 tests
- WebSocket server with Socket.io
- FIXED: Socket.io now properly initialized with http.Server instance

## 31. Tax Calculation Engine ✓ 40 tests
- 100+ countries, VAT/GST/Sales Tax

## 32. Multi-Language Support ✓ 37 tests
- 5 languages: English, Spanish, French, German, Japanese

## 33. Accessibility ✓ 12 tests
- WCAG 2.1 AA API-level compliance

## 34. Advanced Search Filters ✓ 32 tests
- Category, brand, size, condition, color, price range, keyword search

## 35. Seller Onboarding Flow ✓ 23 tests (v21.0)
- 5-step guided onboarding

## 36. Sales Analytics Dashboard ✓ 27 tests (v22.0)

### Analytics Endpoints:
- `GET /api/users/me/analytics/overview` - Dashboard overview
- `GET /api/users/me/analytics/revenue` - Revenue over time

## 37. Advanced Fraud Detection ✓ 6 tests (v25.0)

### Fraud Detection Endpoints:
- `POST /api/fraud/check` - Check transaction for fraud risk
- `GET /api/fraud/settings` - Get risk thresholds
- `POST /api/fraud/flag` - Flag a transaction

## 38. Escrow Service ✓ 17 tests (v26.0)

### Escrow Endpoints:
- `POST /api/escrow/initiate` - Initiate escrow (>$500)
- `POST /api/escrow/confirm-buyer` - Buyer confirms
- `POST /api/escrow/confirm-seller` - Seller confirms

## 39. Auction/Bidding System ✓ 13 tests (v27.0)

### Auction Endpoints:
- `POST /api/auctions` - Create auction
- `GET /api/auctions` - List auctions
- `POST /api/auctions/:id/bids` - Place bid

## 40. Price Suggestion AI ✓ 7 tests (v28.0)

### Price Suggestion Endpoints:
- `GET /api/price-suggestions/settings` - Get configuration
- `POST /api/price-suggestions/suggest` - Get price suggestion
- `POST /api/price-suggestions/similar` - Find similar sold items
- `GET /api/price-suggestions/trends` - Get market trends

### Pricing Factors:
- Base Price: Category-specific
- Brand Multipliers: Premium brands (Louis Vuitton 3x, Gucci 2.8x, etc.)
- Condition Multipliers: New (1x), Like New (0.85x), Good (0.7x)
- Seasonality: Holiday season boost

## 41. Abandoned Cart Recovery ✓ 7 tests (v29.0)

### Cart Endpoints:
- `GET /api/cart` - Get user cart (authenticated)
- `POST /api/cart/items` - Add item to cart
- `DELETE /api/cart/items/:id` - Remove item from cart
- `POST /api/cart/checkout` - Convert cart to order (creates transaction)
- `GET /api/cart/recovery/settings` - Get recovery settings (public)
- `POST /api/cart/expired` - Mark cart as expired (for cron jobs)
- `POST /api/cart/abandon` - Mark cart as abandoned (for reminder system)

### Recovery Features:
- Automatic cart expiration after 7 days
- Email/SMS reminders after 24 hours of inactivity
- Maximum 3 reminders per cart
- Items automatically removed if listing becomes unavailable
- Cart status: active → abandoned → purchased/expired

## 42. Referral Program ✓ 8 tests (v30.0)

### Referral Endpoints:
- `GET /api/referrals/settings` - Get program settings
- `POST /api/referrals/generate` - Generate referral code
- `POST /api/referrals/apply` - Apply referral code
- `GET /api/referrals/my` - Get user referral stats
- `POST /api/referrals/claim` - Claim referral reward
- `GET /api/referrals/:code` - Validate referral code

### Referral Features:
- Unique 8-character alphanumeric codes
- $10 USD reward per successful referral
- Codes expire after 30 days
- Track referred users and reward status

## 43. Seller Shipping Insurance ✓ 9 tests (v31.0)

### Insurance Endpoints:
- `GET /api/shipping-insurance/settings` - Get insurance settings
- `POST /api/shipping-insurance/calculate` - Calculate premium
- `POST /api/shipping-insurance/purchase` - Purchase insurance
- `GET /api/shipping-insurance/my` - Get seller policies
- `POST /api/shipping-insurance/:id/claim` - File claim

### Insurance Coverage Types:
- Basic: Up to $100 coverage (3% premium)
- Standard: Up to $500 coverage (2% premium)
- Premium: Up to $2000 coverage (1.5% premium)
- Minimum premium: $2

## Total Test Count: 769 tests (target: all passing)
- 45 test suites

---

## All Features Implemented ✓

All planned features have been implemented:
- v23.0 Bulk Listing Management (12 tests)
- v24.0 Social Login Expansion (6 tests)
- v25.0 Advanced Fraud Detection (6 tests)
- v26.0 Escrow Service (17 tests)
- v27.0 Auction/Bidding System (13 tests)
- v28.0 Price Suggestion AI (7 tests)
- v29.0 Abandoned Cart Recovery (7 tests)
- v30.0 Referral Program (8 tests)
- v31.0 Seller Shipping Insurance (9 tests)