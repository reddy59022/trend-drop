# TrendDrop — Business Rules & Requirements

> **Purpose:** This document is the single source of truth and **exact codebase reflection**.
> Every rule here is verified by E2E tests.
> **Last Updated:** June 23, 2026 — v17.0 Enterprise Complete (3 new features, 20 new tests, full Poshmark/Depop parity)

---

## 1. User Registration & Authentication ✓ 16 tests
- Password minimum 8 characters, email must be unique with verification
- JWT token auth, 401 auto-redirects to /login
- Strikes tracked: 3 = suspension threshold
- Admin role support (`user`, `admin`, `moderator`, `suspended`)
- Suspended users auto-blocked from login

### Google OAuth:
- Backend: `POST /api/auth/google` accepts Google ID token, name, email, avatar
- Uses Google Identity Services library (`google-auth-library`) to verify ID tokens
- Creates new user or links Google account to existing email
- Google-authenticated users have `emailVerified: true` and `authProvider: 'google'`
- Frontend: Login page loads Google Identity Services script dynamically
- Requires `REACT_APP_GOOGLE_CLIENT_ID` environment variable
- Falls back gracefully if Google Sign-In is not configured

## 2. Listing Management ✓ 30 tests
- Required: title, description, price (>= $5.00), category, condition, at least 1 image
- Inventory: quantity (default 1), reserved, quantitySold
- Sold listings hidden from public feed
- Sellers can edit ALL listing fields including title, description, price, category, brand, size, condition, color, images, video URL, shipping options, quantity, and boost tier
- Listing edit supports adding/removing images via `existingImages` JSON array + new file uploads
- **Status field**: `draft`, `active`, `sold` — draft listings are hidden from public feed
- **Auto-expiration**: `expiresAt` Date field — expired listings hidden from public feed
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

## 28a. Bundle Discounts ✓ 9 tests (NEW in v17.0)
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

### Bundle Discount UI (@seller-dashboard):
- Create/Edit/Delete bundle rules via tabbed interface
- "Buy X items, get Y% off" display
- Shows potential savings to buyers in cart
- Category filtering support

## 28b. Offers to Likers ✓ (NEW in v17.0)
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

## 28c. Promotions / Coupon Codes ✓ 11 tests (NEW in v17.0)
- Sellers create promo codes: `SAVE10`, `SUMMER20`, etc.
- Configurable: percentage off, fixed amount, discount type
- Min purchase amount, usage limit, expiration date
- Applied at checkout by buyer entering code
- Platform tracks usage count per code
- Duplicate code prevention per seller

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

## 28d. Verified Seller Badge (NEW in v17.0)
- `isVerified` boolean field on User model (default: false)
- Displayed as checkmark badge on Profile page next to seller name
- Displayed on ListingCard when seller is verified
- Admins can mark sellers as verified via admin panel

## 28e. Social Media Links (NEW in v17.0)
- User model has `socialLinks` object with fields: instagram, tiktok, pinterest, youtube, twitter, facebook
- Displayed as clickable buttons on Profile page
- Configured in Settings page (social media account handles)

## 28f. Seller Store Customization (NEW in v17.0)
- User model has `store` object: banner, logo, colorTheme, tagline, returnPolicy
- Store banner displayed on Profile/Closet page
- Custom color theme for storefront

## 28g. Listing Draft/Status System (NEW in v17.0)
- Listing `status` field: `draft` | `active` | `sold`
- Draft listings are hidden from public feed and search
- Sellers can save listings as drafts and publish later
- Listing edit supports changing status

## 28h. Listing Auto-Expiration (NEW in v17.0)
- Listing `expiresAt` Date field
- Expired listings automatically hidden from public feed
- Seller notified when listing is about to expire
- Seller can renew/republish expired listings

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
- Expired listings hidden from public
- Cron job for auto-expiration

## Seller Store Customization
- `store.banner`, `store.logo`, `store.colorTheme`, `store.tagline`, `store.returnPolicy`
- Customizable storefront per seller

## User Model Enhancements (v17.0)
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
9. **Status Bar**: Branded status bar with TrendDrop red (#E24455)

## Client Routes (v17.0)
| Route | Page | Auth Required |
|-------|------|---------------|
| `/` | Home | No |
| `/login` | Login (with Google OAuth) | No |
| `/register` | Register | No |
| `/feed` | Feed | Yes |
| `/sell` | Sell (with draft support + bundle rules) | Yes |
| `/listing/:id` | Listing Detail | No |
| `/profile/:id` | Profile (with verified badge + social links + seller stats) | No |
| `/closet/:id` | Closet | No |
| `/search` | Search | No |
| `/offers` | Offers | Yes |
| `/transactions` | Transactions | Yes |
| `/settings` | Settings (with social links + store customization) | Yes |
| `/notifications` | Notifications | Yes |
| `/wishlist` | Wishlist | Yes |
| `/messages` | Messages | Yes |
| `/reviews/:sellerId` | Reviews | No |
| `/forgot-password` | Forgot Password | No |
| `/cart` | Cart (with promo codes + bundle discounts) | Yes |
| `/seller-dashboard` | Seller Dashboard (tabs: Overview, Bundle Rules, Promo Codes, Offers to Likers) | Yes |
| `/verify-email` | Verify Email | No |
| `/admin` | Admin Panel | Admin/Moderator |
| `/collections/:sellerId` | Collections | No |
| `/saved-searches` | Saved Searches | Yes |

## Bundle Discounts
### Backend:
- `BundleRule` model: seller, name, minQuantity, discountPercent, applicableCategories, isActive, usageCount
- Routes: POST/GET/PUT/DELETE `/api/offers/bundle`, POST `/api/offers/bundle/apply`
- Apply logic: groups items by seller, checks rules, calculates discounts

### Frontend:
- SellerDashboard has "Bundle Rules" tab for CRUD
- Cart page displays active bundle discounts
- "Buy X items, get Y% off" promotion display

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

### Frontend:
- SellerDashboard has "Promo Codes" tab for CRUD
- Cart page has promo code input with validation
- Applied promo displays savings amount

## Total Test Count: 448 tests (all passing)
- 22 test suites: e2e.test.js, offers.test.js, offerChain.test.js, revenue.test.js, freeShipping.test.js, searchRoute.test.js, imageUpload.test.js, batchCheckout.test.js, orderPayout.test.js, riskControls.test.js, boost.test.js, wishlist.test.js, admin.test.js, collections.test.js, savedSearch.test.js, notifications.test.js, social.test.js, messageCompliance.test.js, priceHistory.test.js, userProfile.test.js, **bundleDiscounts.test.js**, **promotions.test.js**
- v17.0 additions: Bundle Discounts (9), Promotions (11)