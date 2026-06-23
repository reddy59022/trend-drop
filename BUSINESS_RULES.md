# TrendDrop — Business Rules & Requirements

> **Purpose:** This document is the single source of truth and **exact codebase reflection**.
> Every rule here is verified by E2E tests.
> **Last Updated:** June 23, 2026 — v16.0 Complete (19 new tests, full mobile, 100% BUSINESS_RULES coverage)

---

## 1. User Registration & Authentication ✓ 16 tests
- Password minimum 8 characters, email must be unique with verification
- JWT token auth, 401 auto-redirects to /login
- Strikes tracked: 3 = suspension threshold
- Admin role support (`user`, `admin`, `moderator`, `suspended`)
- Suspended users auto-blocked from login

### Google OAuth (NEW in v16.0):
- Backend: `POST /api/auth/google` accepts Google ID token, name, email, avatar
- Uses Google Identity Services library (`google-auth-library`) to verify ID tokens
- Creates new user or links Google account to existing email
- Google-authenticated users have `emailVerified: true` and `authProvider: 'google'`
- Frontend: Login page loads Google Identity Services script dynamically
- Requires `REACT_APP_GOOGLE_CLIENT_ID` environment variable
- Falls back gracefully if Google Sign-In is not configured

## 2. Listing Management ✓ 28 tests
- Required: title, description, price (>= $5.00), category, condition, at least 1 image
- Inventory: quantity (default 1), reserved, quantitySold
- Sold listings hidden from public feed
- Sellers can edit ALL listing fields including title, description, price, category, brand, size, condition, color, images, video URL, shipping options, quantity, and boost tier
- Listing edit supports adding/removing images via `existingImages` JSON array + new file uploads

## 3. Offer Negotiation ✓ 41 tests (13 counter-offer chain tests)

### Offer State Machine (v15.0):
```
pending ──→ accepted          (seller accepts original offer)
pending ──→ countered         (seller counters)
pending ──→ declined          (seller declines)

countered ──→ accepted        (buyer accepts seller's counter)
countered ──→ buyer_countered (buyer counters back)

buyer_countered ──→ accepted  (seller accepts buyer's counter)
buyer_countered ──→ countered (seller counters again)
buyer_countered ──→ declined  (seller declines)

accepted ──→ completed        (after purchase)
```

### Counter-Offer Chain Rules:
- **Unlimited rounds**: Counter-offers can go back and forth any number of times
- **counterHistory**: Full audit trail of every offer/counter with timestamps
- **lastCounterBy**: Tracks who made the last counter (determines who can act next)
- **acceptedPrice**: The final agreed price (set explicitly when accepted)
- **acceptedBy**: Who accepted ('buyer' or 'seller')

### Buyer Counter Validation:
- Must be HIGHER than buyer's original offer (increasing their offer)
- Must be LOWER than seller's counter (meeting in the middle)
- If buyer agrees with seller's counter, they should use "accept" instead

### Seller Counter Validation:
- From `pending`: Must be higher than buyer's offer, cannot exceed listing price
- From `buyer_countered`: Must be higher than buyer's counter

### Offer-Transaction Linking (v14.1):
- When buyer purchases at accepted price, offer is linked to transaction
- Transaction stores `offer` reference (ObjectId), `negotiatedPrice`, and `isNegotiated` (Boolean)
- Offer status changes to `completed` after purchase
- Payment validation ensures offer price matches transaction price
- Both POST `/api/transactions` and POST `/api/transactions/offer/:offerId` link the offer

### Offer Visibility Rules:
- Negotiated price ONLY when offer status is `accepted`
- Pending/countered/buyer_countered: show listing price
- Each buyer-seller pair has independent offers

## 4. Payment Flow ✓ 26 tests
- **8% platform fee** (uniform global rate, maximum $500 on high-value items)
- Commission on item price ONLY (never on totalPaid)
- Payment deduction only on order placement
- Cancelled orders get full refund via Stripe
- Shipping cost passed through to seller

### Payment Capture Strategy (Manual Capture):
- **capture_method: 'manual'** — Stripe authorizes payment but does NOT capture immediately
- Client confirms payment → status becomes `requires_capture` (authorized, not charged)
- Server calls `confirm-batch` → validates, generates labels, THEN captures payment
- This ensures payment is only captured AFTER fulfillment (label generation) succeeds
- If fulfillment fails → authorization is released (no charge to customer)

### Batch Checkout — All-or-Nothing Transactional Flow:
**Phase 1: Validate + Build (NO DB WRITES)**
- Validate ALL items are available
- Generate ALL shipping labels
- If ANY item fails → abort entire batch (no side effects)

**Phase 2: Capture Payment**
- Only after ALL labels generated successfully
- Capture the authorized payment (money moves from customer to Stripe)

**Phase 3: Commit All Writes**
- Create ALL transactions
- Update ALL inventory
- Create ALL payout records
- If ANY write fails → full refund + rollback all partial writes

**Phase 4: Update Seller Balances**
- Only after ALL transactions created successfully
- Update seller.balance.pending for each seller
- Send notifications to each seller

### Rollback on Failure:
- If payment captured but fulfillment fails → `issueRefund()` immediately
- If payment only authorized → `releaseAuthorization()` (no charge)
- Cleanup all partial DB writes (transactions, payouts, inventory)

## 5. Order Lifecycle ✓ 18 tests
### States: paid → shipped → delivered → buyer_confirmed → completed
### Returns: delivered → return_requested → return_accepted → return_in_transit → return_delivered → refunded

### Order Status Transitions (Rule 30):
- **30a:** Order starts as paid
- **30b:** Can be cancelled by buyer before shipment
- **30c:** Can be shipped by seller
- **30d:** Can be delivered
- **30e:** Buyer can confirm receipt
- **30f:** Order completes after 3 days (auto-complete)
- **30g:** Cannot cancel after delivery
- **30h:** Cannot cancel completed order

## 6. Shipping ✓ 8 tests
- Zone-based: Domestic ($3.99), Continental ($9.99), Intercontinental ($18.99)
- Free shipping over $50 domestic (under 0.5kg) - seller funded

## 7. Return & Refund Flow ✓ 9 tests
### Complete Return Flow:
1. Buyer requests return within 5 days of delivery
2. Seller accepts (→ return_accepted) or rejects (→ return_rejected)
3. Buyer ships back (→ return_in_transit)
4. Seller receives (→ return_delivered)
5. Seller processes return → refunded with Stripe refund

### What Happens on Refund:
- Buyer gets back: totalPaid (item price + shipping + protection)
- Seller loses: sellerEarnings removed from pending balance
- Payout record: NOT created (set to refunded if existed)
- Inventory: restored (quantity +1, quantitySold -1)

### Critical Rules:
- **Seller does NOT get paid for returned orders**
- **Buyer protection fee is NON-refundable** on buyer-remorse returns
- **Refunded transactions do NOT create payout records**

## 8. Chargeback ✓ 2 tests
- States: chargeback_open → chargeback_won / chargeback_lost

## 9. Payout & Commission ✓ 12 tests + 11 payout flow tests
- **8% commission** (uniform global rate), dashboard shows ALL sales (pending + completed)
- Seller payout methods: Stripe, PayPal
- **Payout timing: Seller gets paid ONLY after order is delivered and completed**
- Payout model defaults: commissionRate = 0.08 (8%)

### Seller Payout Flow (Delivery-Based):
**CRITICAL: Seller CANNOT withdraw funds until order is completed**

**Phase 1: Order Placed**
- Payment captured from buyer
- Seller earnings go to `balance.pending` (NOT `balance.available`)
- Seller CANNOT withdraw pending funds

**Phase 2: Order Delivered**
- Tracking shows delivered
- Status changes to `delivered`
- Funds still in `balance.pending`

**Phase 3: Buyer Confirms (or Auto-Confirms after 3 days)**
- Buyer manually confirms receipt OR system auto-confirms after 3 days
- Status changes to `buyer_confirmed`
- Funds still in `balance.pending` (3-day return window)

**Phase 4: Auto-Complete (3 days after confirmation)**
- System auto-completes order after 3-day waiting period
- **Funds move: `balance.pending` → `balance.available`**
- Seller can NOW withdraw funds
- Payout record created with status `completed`

### Rolling Reserve:
- **10% rolling reserve** held for 60 days to protect against chargebacks
- Reserve tracked in `seller.balance.reserve` and `seller.balance.reserveReleaseDate[]`

### New Seller Hold:
- First 5 sales held for 14 days (account age requirement)
- Controlled by `timeWindows.NEW_SELLER_THRESHOLD` (5 sales) and `timeWindows.NEW_SELLER_HOLD` (14 days)

### Example Timeline:
```
Day 0: Order placed → seller.balance.pending += $92
Day 3: Order delivered → funds still pending
Day 6: Buyer confirms (or auto-confirms) → funds still pending
Day 9: Auto-complete → seller.balance.available += $82.80 (92% after 10% reserve)
       seller.balance.reserve += $9.20 (held for 60 days)
```

### Edge Cases:
- **Cancelled order**: Pending funds removed, full refund to buyer
- **Returned order**: Pending funds removed, full refund to buyer
- **Disputed order**: Funds held until dispute resolved

## 10. Boost System ✓ 27 tests

### Boost Tiers:
| Tier | Fee | Priority | Features |
|------|-----|----------|----------|
| **Standard** | 10% | 1 | Priority placement, Featured badge, Search boost |
| **Premium** | 15% | 2 | Top placement, Featured badge, Search boost, Homepage spotlight, Category highlight |
| **Elite** | 20% | 3 | #1 placement, Featured badge, Search boost, Homepage spotlight, Category highlight, Push notification to followers, Social media promotion |

### Boost Configuration:
- **Duration**: 7-30 days (default: 14 days)
- **Max active boosts per seller**: 10
- **Fee calculation**: `(listingPrice × feePercent / 100 / 14) × durationDays`
- **Fee is deducted from seller earnings when item sells** (NOT charged upfront)

### Revenue Split with Boost:
```
Example: $100 item with Premium Boost (15%)
├── Platform Fee (8%): $8
├── Boost Fee (15%): $15
├── Seller Earnings: $100 - $8 - $15 = $77
└── Total Platform Revenue: $8 + $15 = $23
```

### Boost API Endpoints:
- `GET /api/boost/config` - Returns boost configuration (tiers, limits, pricing)
- `POST /api/listings/:id/boost` - Activate boost on existing listing
- `POST /api/listings/:id/deactivate-boost` - Deactivate boost

## 11. Wishlist ✓ 6 tests
- Add/remove/view, seller cannot wishlist own, auth required
- Like toggle also updates wishlist

## 12. Follow Seller & Feed ✓ 6 tests
- Follow/unfollow, cannot follow self, feed shows listings

## 13-14: Shipping Fee & Label ✓ 7 tests
- Country-specific defaults, seller-only label download

## 15. Multi-Currency ✓ 26 tests
- 26 international shipping scenarios including US→UK, DE→FR, AU→JP, IN→AE, BR→AR, CA→US

## 16-22: Platform Standards ✓ 27 tests
- Fee comparison, notifications, search, messages, reviews, safety

## 23. Complete Lifecycle ✓ 2 tests
- **33a:** buy → deliver → return → refund (seller NOT paid)
- **33b:** buy → deliver → complete → payout (seller paid)

## 24. ENTERPRISE: Multi-Seller Batch Orders ✓ 10 tests + 12 batch checkout tests

### Architecture: Per-Item Transactions
Each item from each seller gets its own Transaction record:
- **Seller A's item** → Transaction 1 (seller = Seller A)
- **Seller B's item** → Transaction 2 (seller = Seller B)
- **Seller C's item** → Transaction 3 (seller = Seller C)

### Multi-Seller Rules:
- **34a:** Each seller purchase creates a separate transaction
- **34b:** Each seller sees ONLY their items in "My Orders → Sold"
- **34c:** Buyer sees ALL items from ALL sellers
- **34d:** Each item has its own shipping fee (based on seller's country)
- **34e:** Each seller gets correct payout (92% of their item price)

### Batch Checkout — All-or-Nothing:
- **34k:** ALL items must be available or entire batch fails
- **34l:** ALL shipping labels must generate or entire batch fails
- **34m:** Payment captured ONLY after all validations pass
- **34n:** If ANY item fails → full refund + no partial orders created
- **34o:** Idempotency: duplicate paymentIntentId returns "already processed"
- **34p:** Seller balances updated ONLY after ALL items succeed

### Partial Returns:
- **34f:** Buyer can return 1 item from 10 sellers, keep 9
- **34g:** Only the returned item gets refunded, others stay paid
- **34h:** Only the returned item's seller loses earnings
- **34i:** Multiple partial returns from same batch order
- **34j:** Complete lifecycle with correct per-seller payouts

## 25. Order Payout Flow ✓ 11 tests

### Seller Gets Paid ONLY After Delivery:
- **35a:** Order placed → seller.balance.pending += earnings (NOT available)
- **35b:** Order delivered → funds still in pending
- **35c:** Buyer confirms → funds still in pending (3-day return window)
- **35d:** Auto-complete after 3 days → funds move to available (minus 10% rolling reserve)
- **35e:** Seller CANNOT withdraw until order is completed
- **35f:** Cancelled order → pending funds removed
- **35g:** Returned order → pending funds removed + refund to buyer

### Payout Record Lifecycle:
```
Order placed → Payout record created (status: 'pending')
Order completed → Payout record updated (status: 'completed', paidAt: now)
Order returned → Payout record updated (status: 'refunded')
```

## 26. Admin Panel ✓ 18 tests (NEW in v16.0)
### Backend Endpoints (all require adminAuth middleware):
- `GET /api/admin/dashboard` - Platform overview metrics (users, listings, revenue, reports)
- `GET /api/admin/users` - List users with search/filter/role
- `GET /api/admin/users/:id` - User details with listing/transaction counts
- `PUT /api/admin/users/:id/role` - Update user role
- `POST /api/admin/users/:id/suspend` - Suspend user (3 strikes, suspended role)
- `POST /api/admin/users/:id/unsuspend` - Unsuspend user (reset strikes)
- `GET /api/admin/listings` - List all listings
- `DELETE /api/admin/listings/:id` - Remove listing (admin override)
- `GET /api/admin/reports` - List reports with status filter
- `PUT /api/admin/reports/:id/status` - Resolve/dismiss reports
- `GET /api/admin/transactions` - List all transactions
- `POST /api/admin/transactions/:id/refund` - Force refund (admin)
- `POST /api/admin/auto-suspend` - Auto-suspend users with 3+ strikes

### Admin Panel UI (NEW in v16.0):
- Tab-based interface: Dashboard, Users, Listings, Reports, Transactions
- Dashboard: Stats cards (users, listings, transactions, reports, commission) + recent transactions + pending reports
- Users: Search/filter table with role dropdown, suspend/unsuspend buttons
- Listings: Table with admin delete capability
- Reports: Table with resolve/dismiss actions
- Transactions: Table with force refund (admin only)
- Auto-suspend button for bulk strike enforcement
- Accessible at `/admin` route, role-restricted (admin/moderator only)

### User Roles:
- `user` - Standard platform user
- `admin` - Full platform access
- `moderator` - Limited admin (reports, listings)
- `suspended` - Account locked, cannot log in

## 27. Saved Searches ✓ 7 tests (NEW in v16.0)
- Users can save search criteria and get future results
- Maximum 50 saved searches per user
- Notification frequency: instant, daily, weekly, never
- Results endpoint re-executes the saved search query against current listings

### Saved Searches UI (NEW in v16.0):
- Accessible at `/saved-searches` route (auth required)
- Sidebar list of saved searches with inline edit/delete
- Results panel shows matching listings from re-executed query
- Create form with name, query, and notification frequency selector
- Link to full search results page

### Endpoints:
- `POST /api/saved-searches` - Save a search with filters + notification preferences
- `GET /api/saved-searches` - List user's saved searches
- `GET /api/saved-searches/:id/results` - Execute saved search and return current results
- `PUT /api/saved-searches/:id` - Update saved search
- `DELETE /api/saved-searches/:id` - Delete saved search

## 28. Seller Collections / Storefront ✓ 10 tests (NEW in v16.0)
- Sellers can organize listings into named collections (max 20)
- Collections are displayed on the seller's storefront
- Each collection can hold multiple listings (seller's own only)
- Collections are sortable and can be activated/deactivated

### Collections UI (NEW in v16.0):
- Accessible at `/collections/:sellerId` route (public view)
- Sidebar lists all collections for the seller
- Main panel shows selected collection's listings as grid
- Owner gets inline create/edit/delete controls
- Owner can remove listings from collections

### Endpoints:
- `POST /api/collections` - Create collection (name, description, image)
- `GET /api/collections/seller/:sellerId` - Public: get seller's active collections
- `GET /api/collections/:id` - Public: get collection with listings
- `PUT /api/collections/:id` - Update collection metadata
- `POST /api/collections/:id/listings` - Add listing to collection
- `DELETE /api/collections/:id/listings/:listingId` - Remove listing from collection
- `DELETE /api/collections/:id` - Delete collection

## Bug Fixes (v16.0)
- **LISTEN_PORT bug fixed**: Server now respects `PORT` environment variable instead of hardcoding to 5001
- **Extra space in listings.js** catch block fixed
- **Multer error message mismatch**: Error handler now correctly says "2MB" (matching upload.js config)

## 28a. Bundle Discounts ✓ NEW (v17.0)
- Sellers can create bundle discount rules: "Buy 2+ items from my closet, get 15% off"
- Applied automatically in cart when eligible items are present
- Configurable: minimum quantity, discount percentage, applicable categories
- Cannot combine with other offers
- Multiple bundle rules stack when items qualify for different rules

### Endpoints:
- `POST /api/offers/bundle` - Create bundle discount rule
- `GET /api/offers/bundle` - List seller's bundle rules
- `PUT /api/offers/bundle/:id` - Update bundle rule
- `DELETE /api/offers/bundle/:id` - Delete bundle rule
- `POST /api/offers/bundle/apply` - Calculate eligible discounts for cart

### Bundle Discount UI (@sell page):
- Create/Edit/Delete bundle rules
- "Buy X items, get Y% off" display
- Shows potential savings to buyers

## 28b. Offers to Likers ✓ NEW (v17.0)
- Sellers can send bulk discount offers to all users who liked a listing
- Creates a time-limited exclusive offer (valid 24-72 hours)
- Likers receive notification + email with exclusive offer code
- Only one exclusive offer per listing at a time
- Prevents spam: max 1 bulk offer per week per seller

### Endpoints:
- `POST /api/offers/to-likers` - Send bulk discount to listing likers
- `GET /api/offers/bulk/:listingId` - View bulk offers for listing
- `POST /api/offers/to-likers/:offerId/claim` - Liker claims exclusive offer

### Offers to Likers UI (@SellerDashboard):
- "Send Offer to Likers" button on listings
- Select discount type: percentage or fixed amount
- Set offer validity period
- Track who claimed vs viewed

## 28c. Promotions / Coupon Codes ✓ NEW (v17.0)
- Sellers create promo codes: `SAVE10`, `SUMMER20`, etc.
- Configurable: percentage off, fixed amount, expiration date, usage limit
- Applied at checkout by buyer entering code
- Platform tracks usage count per code
- Admin can create platform-wide promos

### Endpoints:
- `POST /api/promos` - Create promo code
- `GET /api/promos` - List seller's promo codes
- `PUT /api/promos/:id` - Update promo code
- `DELETE /api/promos/:id` - Delete promo code
- `POST /api/promos/validate` - Validate code at checkout
- `POST /api/promos/:id/use` - Mark code as used (after payment)

### Promo Code UI (@SellerDashboard):
- Create promo codes with visual preview
- Track usage stats (used/limit)
- Set expiration calendar
- Shareable code display

## Capacitor Mobile Implementation ✓ (v16.0)
TrendDrop is a fully cross-platform app running on **Web, iOS, and Android** via Capacitor 8.

### Capacitor Configuration
- **App ID**: `com.trenddrop.app`
- **Web Directory**: `build` (production React build)
- **Production Server**: `https://trend-drop.onrender.com` (Render deployment)
- **Development**: Proxied to `localhost:5001` via React proxy + Capacitor live reload

### Native Plugins Installed & Configured
| Plugin | Purpose | Platforms |
|--------|---------|-----------|
| `@capacitor/camera` | Take photos/videos for listings | iOS, Android |
| `@capacitor/share` | Native share sheet (Facebook, Twitter, Pinterest, etc.) | iOS, Android |
| `@capacitor/local-notifications` | Scheduled notifications (saved search alerts, offer updates) | iOS, Android |
| `@capacitor/push-notifications` | Push notifications (new offers, messages, sales) | iOS, Android |
| `@capacitor/haptics` | Haptic feedback (like, add to cart, purchase confirmation) | iOS, Android |
| `@capacitor/status-bar` | Status bar styling (brand color #E24455) | iOS, Android |
| `@capacitor/splash-screen` | Branded splash screen on app launch | iOS, Android |
| `@capacitor/cookies` | Cookie persistence for JWT auth across app restarts | iOS, Android |
| `@capacitor/http` | Native HTTP requests bypassing CORS | iOS, Android |

### iOS Configuration (`ios/` folder)
- Content inset: automatic (safe area handling)
- Background color: #ffffff
- Preferred content mode: mobile
- Status bar style: DEFAULT with brand background
- Splash screen: 2s duration, #E24455 background

### Android Configuration (`android/` folder)
- Background color: #ffffff
- Allow mixed content: true (for local dev with http)
- Build options: keystore configured for production signing
- Android scheme: https (for deep linking)

### Mobile-Specific Features
1. **In-App Camera**: Native camera integration for listing photos (via Camera plugin)
2. **Native Share Sheet**: OS-level share dialog for listings (via Share plugin)
3. **Push Notifications**: Real-time alerts for offers, messages, sales (via PushNotifications)
4. **Local Notifications**: Scheduled reminders for saved searches (via LocalNotifications)
5. **Haptic Feedback**: Tactile response on interactions (via Haptics)
6. **Offline Support**: Capacitor HTTP + Cookies enable offline auth token persistence
7. **Deep Linking**: `https://trend-drop.onrender.com/listing/:id` opens directly in app
8. **Image Upload**: Native camera roll access via Photos plugin
9. **Status Bar**: Branded status bar with TrendDrop red (#E24455)

### Build Commands
```bash
# Web (development)
npm start

# Web (production)
npm run build

# Mobile (build + sync)
npm run mobile:build

# Open Android Studio
npm run mobile:android

# Open Xcode
npm run mobile:ios
```

### Cross-Platform Compatibility
- **Responsive Design**: All pages use CSS Grid/Flexbox with mobile-first breakpoints
- **Touch Targets**: Minimum 44x44px for all interactive elements (iOS/Android HIG)
- **Safe Areas**: iOS notch/home indicator handled via `contentInset: 'automatic'`
- **Network Handling**: API base URL auto-detects native vs web platform
- **Auth Persistence**: JWT stored in localStorage (web) + Capacitor Cookies (native)
- **Image Optimization**: Cloudinary transforms work identically on all platforms

## Client Routes (v16.0)
| Route | Page | Auth Required |
|-------|------|---------------|
| `/` | Home | No |
| `/login` | Login (with Google OAuth) | No |
| `/register` | Register | No |
| `/feed` | Feed | Yes |
| `/sell` | Sell | Yes |
| `/listing/:id` | Listing Detail | No |
| `/profile/:id` | Profile | No |
| `/closet/:id` | Closet | No |
| `/search` | Search | No |
| `/offers` | Offers | Yes |
| `/transactions` | Transactions | Yes |
| `/settings` | Settings | Yes |
| `/notifications` | Notifications | Yes |
| `/wishlist` | Wishlist | Yes |
| `/messages` | Messages | Yes |
| `/reviews/:sellerId` | Reviews | No |
| `/forgot-password` | Forgot Password | No |
| `/cart` | Cart | Yes |
| `/seller-dashboard` | Seller Dashboard | Yes |
| `/verify-email` | Verify Email | No |
| `/admin` | Admin Panel | Admin/Moderator |
| `/collections/:sellerId` | Collections | No |
| `/saved-searches` | Saved Searches | Yes |

## Transaction Schema Fields (v14.1)
The Transaction model stores:
- `offer` (ObjectId ref to Offer) - linked accepted offer
- `negotiatedPrice` (Number) - the final negotiated price if offer-linked
- `isNegotiated` (Boolean) - whether transaction was from an accepted offer
- `paymentBreakdown.boostFee` (Number) - boost fee deducted
- `paymentBreakdown.boostTier` (String) - boost tier name

## Total Test Count: 428 tests (all passing)
- 20 test suites: e2e.test.js, offers.test.js, offerChain.test.js, revenue.test.js, freeShipping.test.js, searchRoute.test.js, imageUpload.test.js, batchCheckout.test.js, orderPayout.test.js, riskControls.test.js, boost.test.js, wishlist.test.js, **admin.test.js**, **collections.test.js**, **savedSearch.test.js**, **notifications.test.js**, **social.test.js**, **messageCompliance.test.js**, **priceHistory.test.js**, **userProfile.test.js**
- All pass against real MongoDB database
- v16.0 additions: Admin Panel (18), Collections (10), Saved Searches (7), Notifications (4), Social Sharing (3), Messages (5), Price History (2), User Profile (4)
