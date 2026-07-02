# TrendDrop — Business Rules & Requirements

> **Purpose:** This document is the single source of truth and **exact codebase reflection**.
> Every rule here is verified by E2E tests.
> **Last Updated:** June 23, 2026 — v18.0 Enterprise Complete (Multi-currency payout tests, PENDING→PAID state fix, auto-process reserve, boost in batch, route protection, return claw-back consolidation, 5-currency test suite)

---

## 1. User Registration & Authentication ✓ 16 tests
- Password minimum 8 characters, email must be unique with verification
- JWT token auth, 401 auto-redirects to /login
- Strikes tracked: 3 = suspension threshold
- Admin role support (`user`, `admin`, `moderator`, `suspended`)
- Suspended users auto-blocked from login
- **ProtectedRoute component** guards auth-required routes with role-based access control

### Google OAuth:
- Backend: `POST /api/auth/google` accepts Google ID token, name, email, avatar
- Uses Google Identity Services library (`google-auth-library`) to verify ID tokens
- Creates new user or links Google account to existing email
- Google-authenticated users have `emailVerified: true` and `authProvider: 'google'`
- Frontend: Login page loads Google Identity Services script dynamically
- Requires `REACT_APP_GOOGLE_CLIENT_ID` environment variable
- Falls back gracefully if Google Sign-In is not configured

### ErrorBoundary:
- Global React error boundary catches all uncaught errors
- Differentiates between network errors, auth errors, and generic errors
- Provides "Reload Page" and "Go Home" buttons
- Logs client-side errors to server in production
- Wraps entire app to prevent blank screens

## 2. Listing Management ✓ 30 tests
- Required: title, description, price (>= $5.00), category, condition, at least 1 image
- Inventory: quantity (default 1), reserved, quantitySold
- Sold listings hidden from public feed
- Sellers can edit ALL listing fields including title, description, price, category, brand, size, condition, color, images, video URL, shipping options, quantity, and boost tier
- Listing edit supports adding/removing images via `existingImages` JSON array + new file uploads
- **Status field**: `draft`, `active`, `sold` — draft listings are hidden from public feed
- **Auto-expiration**: `expiresAt` Date field — expired listings auto-hidden by cron job
- **Boost/promotion system**: Standard (10%), Premium (15%), Elite (20%) tiers

## 3. Offer Negotiation ✓ 41 tests (13 counter-offer chain tests)

### Offer State Machine:
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

### Offer-Transaction Linking:
- When buyer purchases at accepted price, offer is linked to transaction
- Transaction stores `offer` reference (ObjectId), `negotiatedPrice`, and `isNegotiated` (Boolean)
- Offer status changes to `completed` after purchase
- Payment validation ensures offer price matches transaction price
- Both POST `/api/transactions` and POST `/api/transactions/offer/:offerId` link the offer

### Offer Visibility Rules:
- Negotiated price ONLY when offer status is `accepted`
- Pending/countered/buyer_countered: show listing price
- Each buyer-seller pair has independent offers

### Bulk Offers / Offers to Likers (NEW in v17.0):
- Sellers can send bulk discount offers to all users who liked a listing
- Creates a time-limited exclusive offer (valid 24-72 hours)
- Likers receive notification with exclusive offer
- Only one exclusive offer per listing at a time
- Prevents spam: max 1 bulk offer per week per seller
- Offer model has `bulkOffer` field: `{ isBulk, discountType, discountValue, claimedBy[] }`

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

### Batch Checkout — Multi-Item Support (v17.5):
- **Single payment intent for ALL items** in the cart (not per-item)
- Supports items from different sellers in one payment
- Promo codes applied at payment intent creation (discounts total)
- Bundle discounts applied at payment intent creation
- All items validated before any payment processing

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

### Order Status Transitions:
- **30a:** Order starts as paid
- **30b:** Can be cancelled by buyer before shipment
- **30c:** Can be shipped by seller
- **30d:** Can be delivered
- **30e:** Buyer can confirm receipt
- **30f:** Order completes after 3 days (auto-complete via cron)
- **30g:** Cannot cancel after delivery
- **30h:** Cannot cancel completed order

### Auto-Complete Cron Job (v17.5):
- Runs every hour
- Moves `delivered` → `buyer_confirmed` after 3 days (auto-confirm)
- Moves `buyer_confirmed` → `completed` after 3 days (releases funds)
- Creates payout records automatically
- Updates seller stats (totalSales) and buyer stats (totalPurchases)

### OrderDetail Page (v17.5):
- Full order status with color-coded badge system
- Order timeline visualization (Order Placed → Shipped → Delivered → Completed)
- Tracking number and tracking history display
- Payment summary with full breakdown
- Seller and buyer info cards
- Action buttons: Cancel Order, Confirm Received, Request Return
- Return/refund info display when applicable
- Route: `/orders/:id`

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
- **Release cron job**: Daily at 2:00 AM, releases any reserve amounts past 60-day hold

### New Seller Hold:
- First 5 sales held for 14 days (account age requirement)
- Controlled by `timeWindows.NEW_SELLER_THRESHOLD` (5 sales) and `timeWindows.NEW_SELLER_HOLD` (14 days)

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

### Promo + Bundle Discount Integration (v17.5):
- Promo codes applied at payment intent creation (discounts total amount)
- Bundle discounts calculated and applied at payment intent creation
- Both discounts reflected in payment intent metadata for audit trail
- Promo usage count incremented on successful order completion
- Bundle discount displayed in cart UI with rule name and savings amount

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

## 26. Admin Panel ✓ 18 tests
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

### Admin Panel UI:
- Tab-based interface: Dashboard, Users, Listings, Reports, Transactions
- Accessible at `/admin` route, role-restricted (admin/moderator only)

## 27. Saved Searches ✓ 7 tests
- Users can save search criteria and get future results
- Maximum 50 saved searches per user
- Notification frequency: instant, daily, weekly, never
- Results endpoint re-executes the saved search query against current listings
- Accessible at `/saved-searches` route (auth required)

## 28. Seller Collections / Storefront ✓ 10 tests
- Sellers can organize listings into named collections (max 20)
- Collections are displayed on the seller's storefront
- Each collection can hold multiple listings (seller's own only)
- Collections are sortable and can be activated/deactivated
- Accessible at `/collections/:sellerId` route (public view)

## 28a. Bundle Discounts ✓ 9 tests
- Sellers can create bundle discount rules: "Buy 2+ items from my closet, get 15% off"
- Applied automatically in cart when eligible items are present
- Configurable: minimum quantity, discount percentage, applicable categories
- Cannot combine with other offers
- Multiple bundle rules stack when items qualify for different rules
- **Fully integrated with payment flow (v17.5):** Bundle discounts applied at payment intent creation

### Endpoints:
- `POST /api/offers/bundle` - Create bundle discount rule
- `GET /api/offers/bundle` - List seller's bundle rules
- `PUT /api/offers/bundle/:id` - Update bundle rule
- `DELETE /api/offers/bundle/:id` - Delete bundle rule
- `POST /api/offers/bundle/apply` - Calculate eligible discounts for cart

### Bundle Discount UI (@seller-dashboard + @cart):
- Create/Edit/Delete bundle rules via tabbed interface
- "Buy X items, get Y% off" display
- Shows potential savings to buyers in cart with rule name and amount
- Category filtering support

## 28b. Offers to Likers ✓
- Sellers can send bulk discount offers to all users who liked a listing
- Creates a time-limited exclusive offer (valid 24-72 hours)
- Likers receive notification + exclusive offer code
- Only one exclusive offer per listing at a time
- Prevents spam: max 1 bulk offer per week per seller

### Endpoints:
- `POST /api/offers/to-likers` - Send bulk discount to listing likers
- `GET /api/offers/bulk/:listingId` - View bulk offers for listing
- `POST /api/offers/to-likers/:offerId/claim` - Liker claims exclusive offer

### Offers to Likers UI (@SellerDashboard):
- "Send Offer to Likers" tab with listing selector
- Select discount type: percentage or fixed amount
- Set offer validity period (24/48/72 hours)
- Max 1 bulk offer per week enforcement

## 28c. Promotions / Coupon Codes ✓ 11 tests
- Sellers create promo codes: `SAVE10`, `SUMMER20`, etc.
- Configurable: percentage off, fixed amount, discount type
- Min purchase amount, usage limit, expiration date
- Applied at checkout by buyer entering code
- Platform tracks usage count per code
- Duplicate code prevention per seller
- **Fully integrated with payment flow (v17.5):** Promo codes applied at payment intent creation, usage incremented on completion

### Endpoints:
- `POST /api/promos` - Create promo code
- `GET /api/promos` - List seller's promo codes
- `PUT /api/promos/:id` - Update promo code
- `DELETE /api/promos/:id` - Delete promo code
- `POST /api/promos/validate` - Validate code at checkout
- `POST /api/promos/:id/use` - Mark code as used (after payment)

### Promo Code UI (@SellerDashboard + @Cart):
- Create/Edit/Delete promo codes in SellerDashboard tab
- Promo code input field on Cart page with validation
- Visual display of applied discounts
- Usage stats tracking

## 28d. Verified Seller Badge ✓
- `isVerified` boolean field on User model (default: false)
- Displayed as checkmark badge on Profile page next to seller name
- Displayed on ListingCard when seller is verified
- Admins can mark sellers as verified via admin panel

## 28e. Social Media Links ✓
- User model has `socialLinks` object with fields: instagram, tiktok, pinterest, youtube, twitter, facebook
- Displayed as clickable buttons on Profile page
- Configured in Settings page (social media account handles)

## 28f. Seller Store Customization ✓
- User model has `store` object: banner, logo, colorTheme, tagline, returnPolicy
- Store banner displayed on Profile/Closet page
- Custom color theme for storefront

## 28g. Listing Draft/Status System ✓
- Listing `status` field: `draft` | `active` | `sold`
- Draft listings are hidden from public feed and search
- Sellers can save listings as drafts and publish later
- Listing edit supports changing status

## 28h. Listing Auto-Expiration ✓ (v17.5)
- Listing `expiresAt` Date field
- **Cron job runs every 6 hours**: auto-expires listings past `expiresAt`
- Expired listings get `status: 'draft'` and `available: false`
- Seller notified when listing is about to expire
- Seller can renew/republish expired listings

## Cron Jobs (v17.5)
| Job | Schedule | Description |
|-----|----------|-------------|
| Listing Auto-Expiration | Every 6 hours | Expire listings past `expiresAt` |
| Order Auto-Processing | Every hour | Auto-confirm delivery (3 days), auto-complete + release funds (3 days) |
| Rolling Reserve Release | Daily at 2:00 AM | Release reserve amounts past 60-day hold |
| Token Cleanup | Daily at 3:00 AM | Delete expired verification tokens |

## Verified Seller Badge
- `isVerified` boolean field on User model
- Displayed on Profile page and ListingCard
- Admins can manage via admin panel

## Social Media Links
- User model has `socialLinks` for Instagram, TikTok, Pinterest, YouTube, Twitter, Facebook
- Displayed as buttons on Profile page
- Configured from Settings page

## Listing Draft/Status
- Listing `status` field: `draft`, `active`, `sold`
- Draft listings hidden from public feed
- Sellers can save as draft and publish later

## Listing Expiration
- `expiresAt` field on Listing model
- Expired listings hidden from public via cron job
- Cron job runs every 6 hours

## Seller Store Customization
- `store.banner`, `store.logo`, `store.colorTheme`, `store.tagline`, `store.returnPolicy`
- Customizable storefront per seller

## User Model Enhancements (v17.0+)
```
User {
  isVerified: Boolean (default: false)
  socialLinks: { instagram, tiktok, pinterest, youtube, twitter, facebook }
  store: { banner, logo, colorTheme, tagline, returnPolicy }
}
```

## Listing Model Enhancements (v17.0)
```
Listing {
  status: String (enum: ['draft', 'active', 'sold'], default: 'active')
  expiresAt: Date
}
```

## Offer Model Enhancements (v17.0)
```
Offer {
  bulkOffer: {
    isBulk: Boolean,
    discountType: String,
    discountValue: Number,
    claimedBy: [ObjectId]
  }
}
```

## Capacitor Mobile Implementation ✓
TrendDrop is a fully cross-platform app running on **Web, iOS, and Android** via Capacitor 8.

### Capacitor Configuration
- **App ID**: `com.trenddrop.app`
- **Web Directory**: `build` (production React build)
- **Production Server**: `https://trend-drop.onrender.com` (Render deployment)

### Mobile-Specific Features
1. **In-App Camera**: Native camera integration for listing photos
2. **Native Share Sheet**: OS-level share dialog for listings
3. **Push Notifications**: Real-time alerts for offers, messages, sales
4. **Local Notifications**: Scheduled reminders for saved searches
5. **Haptic Feedback**: Tactile response on interactions
6. **Offline Support**: Capacitor HTTP + Cookies enable offline auth token persistence
7. **Deep Linking**: `https://trend-drop.onrender.com/listing/:id` opens directly in app
8. **Image Upload**: Native camera roll access via Photos plugin
9. **Status Bar**: Branded status bar with TrendDrop red (#FF385C)

## Client Routes (v17.5)
| Route | Page | Auth Required | Protection |
|-------|------|---------------|------------|
| `/` | Home | No | - |
| `/login` | Login (with Google OAuth) | No | - |
| `/register` | Register | No | - |
| `/feed` | Feed | Yes | ProtectedRoute |
| `/sell` | Sell (with draft support + bundle rules) | Yes | ProtectedRoute |
| `/listing/:id` | Listing Detail | No | - |
| `/profile/:id` | Profile (with verified badge + social links + seller stats) | No | - |
| `/closet/:id` | Closet | No | - |
| `/search` | Search | No | - |
| `/offers` | Offers | Yes | ProtectedRoute |
| `/transactions` | Transactions | Yes | ProtectedRoute |
| `/settings` | Settings (with social links + store customization) | Yes | ProtectedRoute |
| `/notifications` | Notifications | Yes | ProtectedRoute |
| `/wishlist` | Wishlist | Yes | ProtectedRoute |
| `/messages` | Messages | Yes | ProtectedRoute |
| `/reviews/:sellerId` | Reviews | No | - |
| `/forgot-password` | Forgot Password | No | - |
| `/cart` | Cart (with promo codes + bundle discounts) | Yes | ProtectedRoute |
| `/seller-dashboard` | Seller Dashboard (tabs: Overview, Bundle Rules, Promo Codes, Offers to Likers) | Yes | ProtectedRoute |
| `/verify-email` | Verify Email | No | - |
| `/admin` | Admin Panel | Admin/Moderator | ProtectedRoute (admin) |
| `/collections/:sellerId` | Collections | No | - |
| `/saved-searches` | Saved Searches | Yes | ProtectedRoute |
| `/orders/:id` | Order Detail (NEW v17.5) | Yes | ProtectedRoute |

## Bundle Discounts
### Backend:
- `BundleRule` model: seller, name, minQuantity, discountPercent, applicableCategories, isActive, usageCount
- Routes: POST/GET/PUT/DELETE `/api/offers/bundle`, POST `/api/offers/bundle/apply`
- Apply logic: groups items by seller, checks rules, calculates discounts
- **Payment integration**: Applied in `POST /api/payments/create-intent`

### Frontend:
- SellerDashboard has "Bundle Rules" tab for CRUD
- Cart page displays active bundle discounts with rule name and savings
- **Payment integration**: Promo codes sent with items to `POST /api/payments/create-intent`

## Offers to Likers
### Backend:
- `POST /api/offers/to-likers` - sends discount offer to listing likers
- `GET /api/offers/bulk/:listingId` - views bulk offers
- `POST /api/offers/to-likers/:offerId/claim` - claims offer
- Spam prevention: max 1 bulk offer per week per seller
- Notifications sent to all likers

### Frontend:
- SellerDashboard has "Offers to Likers" tab with listing selector
- Discount type (percentage/fixed) and validity period selector
- Claim flow creates accepted offer for buyer

## Promo Codes
### Backend:
- `Promo` model: code, seller, discountType, discountValue, minPurchaseAmount, usageLimit, usageCount
- Routes: CRUD + validate + use
- Validation checks expiration, usage limit, min purchase
- **Payment integration**: Validated and applied in `POST /api/payments/create-intent`
- **Usage tracking**: Incremented in `POST /api/payments/confirm-batch`

### Frontend:
- SellerDashboard has "Promo Codes" tab for CRUD
- Cart page has promo code input with validation
- Applied promo displays savings amount
- **Payment integration**: Promo code sent with items batch in `handleSuccess`

## ErrorBoundary (v17.5)
- Global React ErrorBoundary component wraps the app
- Catches all uncaught JavaScript errors
- Differentiates between:
  - Network errors (connection issues)
  - Auth errors (session expired)
  - Generic errors (unexpected bugs)
- Provides "Reload Page" and "Go Home" actions
- Logs errors to server in production via `/api/reports/client-error`
- Shows error details in development mode (stack trace)

## ProtectedRoute (v17.5)
- Guards all auth-required routes
- Redirects unauthenticated users to `/login` with return URL
- Role-based access control via `requiredRole` prop
- Handles `suspended` user role -> redirects to login
- Shows loading spinner during auth state check

## Total Test Count: 474+ tests (target: all passing)
- 27 test suites: e2e.test.js (177), offers.test.js (27), offerChain.test.js (13), revenue.test.js (33), freeShipping.test.js (8), searchRoute.test.js (11), imageUpload.test.js (6), batchCheckout.test.js (12), orderPayout.test.js (11), riskControls.test.js (21), boost.test.js (38), wishlist.test.js (6), admin.test.js (18), collections.test.js (10), savedSearch.test.js (7), notifications.test.js (5), social.test.js (6), messageCompliance.test.js (6), priceHistory.test.js (5), userProfile.test.js (11), bundleDiscounts.test.js (9), promotions.test.js (11), settingsSocialStore.test.js (8), multiCurrencyPayout.test.js (11), listingAutoExpiration.test.js (5), draftListings.test.js (6), concurrentPurchase.test.js (2), balanceLedger.test.js (5)
- v17.5 additions: Listing auto-expiration, Order auto-processing, Reserve release, Token cleanup, Bundle discount + promo code payment integration, OrderDetail page, ProtectedRoute, ErrorBoundary
- **v18.0 additions:** PENDING→PAID state machine fix, 10% rolling reserve in auto-process (cron + orders), boost fee deduction in batch checkout, duplicate return endpoint consolidated with robust claw-back, route protection on ALL client routes, multi-currency payout test suite (11 tests), return auto-process cron, Cart quantity decrement bug fix, 4 new test suites (21 tests)
- **v18.1 additions:** Listing edit multer/JSON fix, draft listing visibility fix, chargeback state machine, DISPUTE_RESOLVED dead-end fix, 404 catch-all route, NotFound page, platform-specific CSS, safe-area-inset support, cart bundle discount server-side integration

---

## v18.0 Changelog (June 23, 2026)

### Critical Bug Fixes
1. **PENDING→PAID State Machine Transition**: Added `[orderStates.PENDING]: [orderStates.PAID]` to `allowedTransitions` in `server/config/orderLifecycle.js` — the very first transition was missing, causing all `isValidTransition()` calls from pending to return `false`.
2. **Batch Checkout Payment Ordering**: Refactored `POST /api/transactions/batch` to authorize payment FIRST before creating any transactions. Previously transactions were created before payment authorization, leaving orphaned records on payment failure.
3. **Auto-Process Rolling Reserve**: Fixed `POST /api/orders/auto-process` AND `cron.js autoProcessOrders()` to deduct 10% rolling reserve from seller earnings before moving to `balance.available`, matching the manual auto-complete endpoint behavior.
4. **Boost Fee in Batch Checkout**: Added `boostFee` and `boostTier` to batch checkout transaction payment breakdown, with boost fee deducted from seller earnings (same as single-item flow).
5. **Return Claw-Back Consolidation**: Updated `POST /api/orders/process-return` to use robust claw-back logic (deduct from available first, then pending) matching `confirm-return-received` behavior.
6. **Route Protection**: Wrapped all auth-required routes with `<ProtectedRoute>` component and admin route with `<ProtectedRoute requiredRole="admin">`.
7. **Duplicate Requires Cleanup**: Moved all `require()` calls to top of files in `transactions.js`, `orderLifecycle.js`, and `payments.js`.
8. **Cart Quantity Decrement Bug**: Fixed decrement button that allowed quantity to go below 1 — now disabled with visual feedback when quantity <= 1.

### New Business Logic: Return Auto-Processing (Cron Job 5)
- **Auto-reject returns**: After 3 days of seller no response (`SELLER_RESPOND_RETURN`), system auto-rejects the return
- **Auto-expire accepted returns**: After 7 days of buyer not shipping (`RETURN_SHIP_WINDOW`), system restores order to `completed`

### New Test Suites (21 tests)
1. **`listingAutoExpiration.test.js`** (5 tests): Active listing stays active, expireListings expires past-due listings, future expiration preserved, expired hidden from feed, seller sees own expired listings
2. **`draftListings.test.js`** (6 tests): Create draft listing, hidden from feed, hidden from search, seller can view own draft, buyer cannot view draft by ID, publish draft to active
3. **`concurrentPurchase.test.js`** (2 tests): Single-qty race condition (1 succeeds, 1 fails), multi-qty oversell prevention (3 attempts for 2 qty = 2 succeed)
4. **`balanceLedger.test.js`** (5 tests): Order placed → pending increases, cancelled → pending decreases, completed → pending→available (minus 10% reserve), returned → claw-back from available/pending, payout record created on completion not return

---

## v18.1 Changelog (July 2, 2026)

### Critical Bug Fixes
1. **Listing Edit 500 Error (multer/JSON conflict)**: Fixed `PUT /api/listings/:id` to handle both `multipart/form-data` (with file uploads) and `application/json` bodies. Previously, `upload.array('images', 10)` middleware would fail when tests sent JSON body without files, causing 500 errors. Now uses conditional middleware that skips multer for non-multipart requests.
2. **Draft Listing Visibility in Search**: Added `status: 'active'` filter to public listing list and search endpoints. Previously, draft listings were returned in search results and accessible by ID for non-owner users. Now draft listings are properly hidden from public.
3. **Chargeback State Machine Integration**: Added `chargeback_open`, `chargeback_won`, `chargeback_lost` states to `orderLifecycle.js` with proper transitions: `delivered/buyer_confirmed/completed → chargeback_open → chargeback_won → completed` and `chargeback_open → chargeback_lost → refunded`.
4. **DISPUTE_RESOLVED Dead-End Fix**: Added outgoing transitions from `DISPUTE_RESOLVED` to `REFUNDED` and `COMPLETED`, preventing orders from being stuck in a terminal state.
5. **404 Catch-All Route**: Added `<Route path="*" element={<NotFoundPage />} />` to React Router in `App.js` with a user-friendly NotFound page component.

### New Features
1. **NotFound Page**: Created `client/src/pages/NotFound.js` with branded 404 page, "Go Home" and "Browse Listings" action buttons.
2. **Platform-Specific CSS Classes**: Added `.platform-ios`, `.platform-android`, `.platform-web` CSS classes for cross-platform styling.
3. **Safe-Area-Insert Support**: Added `env(safe-area-inset-*)` padding to `globals.css` for iOS notch and home indicator support.
4. **Cart Bundle Discount Server-Side Integration**: Bundle discounts now properly applied at payment intent creation (server-side) rather than being visual-only on the client.

### Updated Business Rules
- **Section 8 (Chargeback)**: States now fully integrated into order lifecycle state machine
- **Section 28g (Draft Listings)**: Clarified that draft listings are hidden from public search and feed
- **Section 2 (Listing Management)**: Added `status` field to listing list fields for proper filtering

---

## Next Enhancements (Planned for v19.0+)

### High Priority
1. **Real Shipping Label Generation**: Replace mock label generator with real carrier API integration (ShipEngine/EasyPost/Shippo) for actual shipping label creation and tracking.
2. **Real-Time Notifications (WebSockets)**: Implement Socket.io for real-time push notifications on offers, messages, sales, and order updates instead of polling.
3. **Guest Checkout**: Allow users to purchase without registering. Capture email for order tracking and send account creation invitation post-purchase.
4. **Tax Calculation**: Add sales tax/VAT/GST calculation per country/region based on seller and buyer locations.
5. **Multi-Language Support (i18n)**: Implement react-i18next for at least 5 languages (English, Spanish, French, German, Japanese).

### Medium Priority
6. **Accessibility (WCAG 2.1 AA)**: Add aria-labels, skip-to-content links, keyboard navigation, focus trapping in modals, proper color contrast ratios.
7. **Advanced Search Filters**: Add filter panel for condition, brand, size, price range, color, and location on search page.
8. **Seller Onboarding Flow**: Guided step-by-step onboarding for new sellers with tips on photography, pricing, and shipping.
9. **Sales Analytics Dashboard**: Charts and graphs for seller revenue, views, likes, conversion rates over time.
10. **Bulk Listing Management**: CSV import for listings, bulk price editing, bulk boost activation.

### Low Priority
11. **Social Login Expansion**: Add Apple Sign-In and Facebook Login beyond existing Google OAuth.
12. **Advanced Fraud Detection**: IP geolocation, device fingerprinting, velocity checks for high-risk transactions.
13. **Escrow Service**: For high-value items (>$500), hold funds in escrow until both parties confirm satisfaction.
14. **Auction/Bidding System**: Allow sellers to list items as auctions with timed bidding.
15. **Price Suggestion AI**: ML-based price recommendations based on similar sold listings, market trends, and seasonality.
16. **Abandoned Cart Recovery**: Email/SMS reminders for users who added items to cart but didn't complete purchase.
17. **Referral Program**: Track referrals with unique codes, reward referrers with platform credits.
18. **Seller Shipping Insurance**: Optional shipping insurance for high-value items.
19. **Size Recommendation Engine**: AI-powered size matching based on brand, item measurements, and user history.
20. **Automated Return Labels**: Generate pre-paid return labels automatically when return is accepted.

---
