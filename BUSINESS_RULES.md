# TrendDrop — Business Rules & Requirements

> **Purpose:** This document is the single source of truth and **exact codebase reflection**.
> Every rule here is verified by E2E tests.
> **Last Updated:** July 2, 2026 — v27.0 Auction/Bidding System (738/738 tests passing)

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
- **ProtectedRoute component** guards auth-required routes with role-based access control

## 2. Listing Management ✓ 30 tests
- Required: title, description, price (>= $5.00), category, condition, at least 1 image
- Inventory: quantity (default 1), reserved, quantitySold
- Sold listings hidden from public feed
- Sellers can edit ALL listing fields
- **Status field**: `draft`, `active`, `sold`
- **Auto-expiration**: `expiresAt` Date field
- **Boost/promotion system**: Standard (10%), Premium (15%), Elite (20%) tiers

## 3. Offer Negotiation ✓ 41 tests
- Unlimited counter-offer chain
- Buyer/seller validation rules
- Offer-transaction linking

## 4. Payment Flow ✓ 26 tests
- **8% platform fee** (maximum $500 cap)
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
- Buyer protection fee NON-refundable on remorse returns

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
- **FIXED**: Socket.io now properly initialized with http.Server instance

## 31. Tax Calculation Engine ✓ 40 tests
- 100+ countries, VAT/GST/Sales Tax

## 32. Multi-Language Support ✓ 37 tests
- 5 languages: English, Spanish, French, German, Japanese

## 33. Accessibility ✓ 12 tests
- WCAG 2.1 AA API-level compliance

## 34. Advanced Search Filters ✓ 32 tests
- Category, brand, size, condition, color, price range, keyword search
- Sorting, pagination, combined filters, mobile optimization

## 35. Seller Onboarding Flow ✓ 23 tests (v21.0)
- 5-step guided onboarding
- Tips, progress tracking, checklist, reset

## 36. Sales Analytics Dashboard ✓ 27 tests (v22.0)

### Analytics Endpoints:
- `GET /api/users/me/analytics/overview` - Dashboard overview with key metrics
- `GET /api/users/me/analytics/revenue` - Revenue over time (day/week/month/year)
- `GET /api/users/me/analytics/top-listings` - Top performing listings by revenue
- `GET /api/users/me/analytics/traffic-sources` - Traffic source breakdown
- `GET /api/users/me/analytics/audience` - Audience demographics

### Overview Metrics:
- **Listings**: total, active, sold counts
- **Revenue**: total earnings from transactions
- **Sales**: total number of transactions
- **Avg Order Value**: revenue / sales
- **Views**: proxy via likes count
- **Offers**: total offers, acceptance rate
- **Ratings**: average rating, total ratings
- **Conversion Rate**: sales / views percentage
- **Recent Activity**: last 5 transactions with buyer info

### Revenue Analytics:
- Time-series data grouped by day/week/month/year
- Period filters: 7d, 30d, 90d, 1y
- Each data point: date, revenue, sales count
- Sorted chronologically

### Top Listings:
- Ranked by revenue generation
- Configurable limit (default 10)
- Period filter for date range
- Includes listing title, images, price, sales count, revenue

### Traffic Sources (Placeholder):
- Direct, Search, Social, Referral breakdown
- Follower growth tracking
- Ready for analytics service integration

### Audience Demographics (Placeholder):
- By country, device (Mobile/Desktop/Tablet), age groups
- Ready for analytics service integration

### Enterprise Standards:
- Auth required for all endpoints
- Users can only see own analytics
- Period parameters: 7d, 30d, 90d, 1y
- Handles no-data gracefully (returns zeros/empty arrays)
- Sub-second response time

## 37. Advanced Fraud Detection ✓ 6 tests (v25.0)

### Fraud Detection Endpoints:
- `POST /api/fraud/check` - Check transaction for fraud risk before payment
- `GET /api/fraud/settings` - Get platform risk thresholds and settings
- `POST /api/fraud/flag` - Flag a transaction for manual review

### Risk Detection Checks:
- **High Value**: Transactions over $500 flagged (threshold configurable)
- **Velocity**: More than 5 transactions per hour flagged (rate limiting)
- **New Account High Value**: Accounts less than 7 days old + high value purchases
- **Invalid Listing**: Check for listing existence/validity
- **IP Geolocation**: Track IP addresses for risk assessment (placeholder for production)

### Risk Scoring:
- **Low Risk**: score 0-24
- **Medium Risk**: score 25-49 (manual review recommended)
- **High Risk**: score 50+ (additional verification required)

### Enterprise Standards:
- Auth required for all endpoints
- Risk score calculation based on multiple factors
- Transaction flagging with audit trail
- Admin can flag any transaction, users can flag own transactions

## 38. Escrow Service ✓ 17 tests (v26.0)

### Escrow Endpoints:
- `POST /api/escrow/initiate` - Initiate escrow for high-value transaction (>$500)
- `POST /api/escrow/confirm-buyer` - Buyer confirms satisfaction
- `POST /api/escrow/confirm-seller` - Seller confirms satisfaction
- `POST /api/escrow/dispute` - File dispute during escrow period
- `POST /api/escrow/resolve-dispute` - Admin resolves escrow dispute
- `GET /api/escrow/settings` - Get escrow configuration

### Escrow States:
- **inactive**: Default state, no escrow
- **active**: Escrow initiated, waiting for confirmation
- **released**: Both parties confirmed, funds released to seller
- **disputed**: Buyer filed dispute, awaiting resolution
- **resolved**: Admin resolved dispute

### Release Conditions:
- Both buyer and seller must confirm satisfaction
- 7-day inspection period for high-value items
- Admin resolution for disputed transactions

### Enterprise Standards:
- Auth required for all endpoints
- Buyer initiates escrow, seller receives notifications
- Funds released with normal platform fee and 10% rolling reserve
- Admin-only dispute resolution

## 39. Auction/Bidding System ✓ 13 tests (v27.0)

### Auction Endpoints:
- `POST /api/auctions` - Create auction for a listing
- `GET /api/auctions` - List auctions with optional filtering
- `GET /api/auctions/:id` - Get single auction details
- `GET /api/auctions/settings` - Get auction configuration
- `POST /api/auctions/:id/bids` - Place bid on auction
- `POST /api/auctions/:id/close` - Close expired auction

### Auction States:
- **scheduled**: Auction created but not started
- **active**: Auction accepting bids
- **closed**: Auction ended, winner determined
- **cancelled**: Auction cancelled by seller

### Auction Features:
- **Reserve Price**: Minimum bid to win
- **Timed Bidding**: Automatic start/end times
- **Bid History**: Track all bids with timestamps
- **Winner Selection**: Highest bid meeting reserve wins

### Enterprise Standards:
- Auth required for creating bids
- Only seller can create auction for their listing
- Only seller or admin can close auction
- Bids must exceed current bid and meet reserve

## Total Test Count: 738 tests (target: all passing)
- 41 test suites
- **v23.0 additions:** 
  - Bulk Listing Management (12 tests)
- **v24.0 additions:**
  - Social Login - Apple & Facebook (6 tests)
- **v25.0 additions:**
  - Advanced Fraud Detection (6 tests)
- **v26.0 additions:**
  - Escrow Service (17 tests)
- **v27.0 additions:**
  - Auction/Bidding System (13 tests)

---

## Version History

### v18.0 (June 23, 2026)
- Critical bug fixes (8 fixes)
- New test suites (21 tests)

### v18.1 (July 2, 2026)
- Critical bug fixes (5 fixes)
- New features (4 features)

### v19.0 (July 2, 2026)
- Guest Checkout, Shipping Labels, WebSockets, Tax, i18n, Accessibility

### v20.0 (July 2, 2026)
- Advanced Search Filters (32 tests)

### v21.0 (July 2, 2026)
- Seller Onboarding Flow (23 tests)

### v22.0 (July 2, 2026)
- **Sales Analytics Dashboard (27 tests)**
- **Socket.io initialization fix** - Server now starts successfully

### v22.1 (July 2, 2026)
- **Render deployment fix**: Moved socket.io to dependencies

### v23.0 (July 2, 2026) - Bulk Listing Management
- **CSV Import/Export**: Create and export listings via CSV files
- **Bulk Status Update**: Update multiple listings to active/draft/sold
- **Bulk Price Update**: Set same price across selected listings (min $5)
- **Bulk Delete**: Remove multiple listings (excludes sold items)
- **Bulk Boost Activation**: Activate boost on multiple listings with tier selection
- **12 tests** covering all bulk operations

### v24.0 (July 2, 2026) - Social Login Expansion
- **Apple Sign-In**: OAuth endpoint at `/api/auth/apple` for iOS/macOS users
- **Facebook Login**: OAuth endpoint at `/api/auth/facebook` for Facebook users
- **UI Integration**: Social login buttons on Login page (Google, Apple, Facebook)
- **Account Linking**: Link social accounts to existing email accounts
- **6 tests** covering Apple and Facebook authentication

### v25.0 (July 2, 2026) - Advanced Fraud Detection
- **Fraud Risk Check API**: Real-time risk scoring before transactions
- **Threshold Management**: Configurable risk thresholds ($500 value, 5/hr velocity)
- **Transaction Flagging**: Audit trail for flagged transactions
- **6 tests** covering fraud detection endpoints

### v26.0 (July 2, 2026) - Escrow Service
- **Escrow for High-Value Transactions**: Automatic escrow for items >$500
- **Dual Confirmation**: Both buyer and seller must confirm satisfaction
- **Dispute Resolution**: Admin-mediated dispute handling
- **17 tests** covering all escrow operations

### v27.0 (July 2, 2026) - Auction/Bidding System
- **Timed Auctions**: Scheduled start/end times for listings
- **Reserve Price Support**: Minimum winning bid configuration
- **Bid Tracking**: Full history of all bids during auction
- **Auto-Close Logic**: Auction closure with winner determination
- **13 tests** covering all auction operations

---

## Next Enhancements (Planned for v28.0+)

### Medium Priority
1. **Price Suggestion AI**: ML-based price recommendations based on similar sold listings, market trends, and seasonality.

### Low Priority
2. **Abandoned Cart Recovery**: Email/SMS reminders for users who added items to cart but didn't complete purchase.
3. **Referral Program**: Track referrals with unique codes, reward referrers with platform credits.
4. **Seller Shipping Insurance**: Optional shipping insurance for high-value items.
5. **Size Recommendation Engine**: AI-powered size matching based on brand, item measurements, and user history.
6. **Automated Return Labels**: Generate pre-paid return labels automatically when return is accepted.