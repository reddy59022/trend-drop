# PRODUCT BACKLOG — Trend-Drop Marketplace

_Author: Product Management · Date: 2026-08-09 · Status: Ready for Architecture/Engineering/QA_

Discovery method: mapped all 59 client pages / ~60 routes / 56 route modules, scanned for stubs and placeholders, audited external integrations and test coverage. The core marketplace (auth, catalog, cart, checkout UI, seller flows, offers, trends, wishlist, orders, payouts) is **built and certified** (1084 jest + 25 Playwright E2E green). The gaps below are what blocks **full production readiness** and **feature parity with the marketing promise** (social commerce, mobile, personalization, trust & safety).

Legend: **P0** = blocks production launch · **P1** = major competitive gap · **P2** = polish/scale · Size: S/M/L

---

## EPIC 1 — Production Payments & Identity (P0)

**Context:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLOUDINARY_*`, `BREVO_API_KEY`, `GOOGLE/APPLE/FACEBOOK_*` are all placeholders. Checkout, image upload, verification/transactional email, and social login cannot work for real users.

### STORY 1.1 — Wire real payment processing with Stripe test mode
As a buyer, I want to pay for my order with a real card flow so that my purchase completes end-to-end.
- Wire actual Stripe keys (test mode first) for PaymentIntents + webhook confirm.
- Verify webhook signature handling against real Stripe test events.
- **AC:** checkout with Stripe test card `4242…` completes; webhook updates order; seller balance/payout record created (existing M1 invariant holds).
- **Affected:** `server/config/payments.js`, `server/routes/payments.js`, `server/routes/stripeWebhook.js`, Cart/Checkout pages.
- **QA:** jest webhook suite with real test-mode events; new Playwright story: full checkout with test card (extends existing "Checkout page renders payment form").

### STORY 1.2 — Functional media uploads (Cloudinary)
As a seller, I want to upload product photos so that my listings look real.
- Wire real Cloudinary credentials; add upload progress, retry, image compression, and validation (type/size).
- **AC:** 1–10 images per listing upload successfully; failed uploads show a retryable error; URLs persist in the listing.
- **Affected:** upload component (to be located/created), `server/routes/listings.js` (multer/cloudinary hooks).
- **QA:** E2E seller listing creation with image upload (mock Cloudinary in E2E server).

### STORY 1.3 — Real verification & transactional email (Brevo/SMTP)
As a new user, I want to receive the verification email so that I can activate my account.
- Send real emails: verification, password reset, order confirmation, shipping update, payout notification, offer received.
- Add email templates + failure retry queue (or graceful fallback).
- **AC:** registering with a real inbox delivers the verification link; link verifies and unlocks the account; password reset works.
- **Affected:** `server/services/emailService*`, auth routes, order lifecycle hooks.
- **QA:** jest with mocked SMTP; manual inbox check.

### STORY 1.4 — Social sign-in (Google/Apple/Facebook)
As a buyer, I want to sign in with my existing social account so that onboarding is frictionless.
- Wire OAuth flows on client + server; link social identities to existing accounts; handle email conflicts.
- **AC:** Google and Apple sign-in work on web and mobile (Apple required for iOS); conflicting email shows a merge/choice screen.
- **Affected:** `server/routes/auth.js`, Login/Register pages, `capacitor.config` for native OAuth.
- **QA:** E2E with mocked OAuth provider; manual native test.

---

## EPIC 2 — Mobile Production Readiness (P0)

**Context:** Android debug APK builds; iOS requires full Xcode (blocked on this machine). No push, no deep links, no biometric unlock despite `MobilePreferences` fields existing.

### STORY 2.1 — Signed Android release build + CI artifact
As a user, I want a signed APK/AAB so that I can install the production app.
- Configure keystore, `capacitor` build pipeline, versioning; produce AAB for Play.
- **AC:** `build-mobile.sh` emits a signed AAB; installs on a physical device; app talks to `trend-drop.onrender.com`.
- **Affected:** `client/android/*`, `build-mobile.sh`, docs.

### STORY 2.2 — iOS build pipeline
As a user, I want an iOS app so that I can use Trend-Drop on iPhone.
- Install full Xcode on a capable machine; pod install; signing; archive.
- **AC:** `client/ios/App/App.xcworkspace` builds and runs on simulator + device; App Store archive produced.
- **Affected:** `client/ios/*`; CI runner with macOS.
- **QA:** manual device test of login/cart/checkout.

### STORY 2.3 — Push notifications (FCM + APNs)
As a buyer, I want to be notified when a seller replies or an offer is accepted so that I don't miss time-sensitive deals.
- Device token registration (`/api/mobile/preferences`), FCM/APNs send service, notification routing to existing `Notifications` model; honor user `pushNotifications` toggle.
- **AC:** offer-accepted and new-message events push to the device; toggling off stops them.
- **Affected:** `server/routes/mobile.js`, new `server/services/pushService.js`, `Notifications.js`, app init.
- **QA:** jest with mocked FCM; manual device test.

### STORY 2.4 — Deep links & native redirect URIs
As a user, I want links from emails/offers to open the app directly so that the experience is seamless.
- Configure Capacitor deep links (listing, order, chat) + OAuth redirect URIs.
- **AC:** `trend-drop.app/listing/:id` opens the listing in-app on both platforms.
- **Affected:** `capacitor.config.ts`, app routing, auth callbacks.

### STORY 2.5 — Biometric unlock
As a user, I want to unlock the app with Face ID / fingerprint so that checkout is secure and fast.
- Use `MobilePreferences.biometric`; native plugin; fall back to password.
- **AC:** enabling biometrics in MobileSettings lets the user unlock and skip password on next launch.
- **Affected:** MobileSettings page, native plugins, auth context.

---

## EPIC 3 — Real-Time Commerce & Messaging (P1)

**Context:** `Messages.js` fetches on mount only — no sockets, SSE, or polling. Buyer↔seller negotiation is the heart of social commerce and currently has no live experience, no unread badges, no typing presence.

### STORY 3.1 — Real-time chat (WebSocket/SSE with fallback polling)
As a buyer, I want messages to arrive instantly so that negotiations feel live.
- Add a real-time transport (Socket.IO or SSE) with polling fallback; mark-as-read sync; unread badge in nav; offline banner.
- **AC:** two users exchanging messages see them appear without refresh; unread counts update; reconnection after network drop.
- **Affected:** new `server/` realtime module, `Messages.js`, `MobileTabBar` badge, `Notifications.js`.
- **QA:** new Playwright story with two browser contexts (buyer & seller chatting).

### STORY 3.2 — Offer negotiation from chat
As a buyer, I want to counter a seller's offer in chat so that we can close the deal.
- Inline offer card in chat: accept/counter/decline; status syncs to `/offers` and `offerSharing`.
- **AC:** counter-offer from chat creates a new offer record; accept triggers the existing checkout flow.
- **Affected:** Messages.js, offers routes.
- **QA:** E2E chat → offer → accept → checkout.

---

## EPIC 4 — Trust & Safety / Admin Moderation (P1)

**Context:** Admin.js is read-only tables (transactions, users, listings). No moderation actions exist. Dispute endpoints exist (`/orders/:id/dispute`) but have no UI and no admin resolution workflow.

### STORY 4.1 — Listing & user moderation console
As an admin, I want to approve/reject/feature/remove listings and suspend users so that the marketplace stays safe.
- Admin actions: hide listing (with reason), feature listing, suspend/unsuspend user, view seller payout status.
- **AC:** actions persist, take effect immediately for end users, and are logged.
- **Affected:** `server/routes/admin.js`, Admin.js page.
- **QA:** jest admin authorization (non-admin 403); E2E admin flow.

### STORY 4.2 — Dispute resolution workflow UI
As a buyer or seller, I want to file and track a dispute so that I get a fair outcome.
- UI to file dispute with evidence (14-day window per existing config), status tracking, admin decision (refund buyer / release to seller), payout adjustment.
- **AC:** dispute lifecycle matches `disputeProcess` config; admin decision moves money atomically.
- **Affected:** `server/routes/orderLifecycle.js` (dispute), OrderDetail/ReturnsCenter pages, admin.
- **QA:** jest full dispute lifecycle; E2E buyer files dispute, admin resolves.

### STORY 4.3 — Content moderation for trends & social posts
As an admin, I want to flag/remove harmful trend content so that the feed stays appropriate.
- Report button on trends/social posts; admin queue; auto-hide on threshold.
- **AC:** reported content is hidden after 3 reports or admin action; user sees a removal reason.
- **Affected:** trends/socialCommerce routes, Trends/SocialCommerce pages, admin.

---

## EPIC 5 — Trust Builders: Reviews, Returns, Escrow UX (P1)

### STORY 5.1 — Post-purchase review flow with photos
As a buyer, I want to leave a photo review after delivery so that sellers build reputation.
- Review prompt after order completion; photo upload; verified-buyer badge; seller reply.
- **AC:** only verified buyers can review; average rating updates on seller profile; abusive review reportable.
- **Affected:** `server/routes/reviews.js`, OrderDetail, Reviews page, Profile.
- **QA:** E2E review after completed order.

### STORY 5.2 — Returns & refund UX with tracking
As a buyer, I want to track my return and refund so that I know my money is safe.
- Return label generation (existing `generateLabel`), status timeline, refund amount breakdown, timeline promises.
- **AC:** return status transitions match `returnEligibility`/`refundRules`; refund posts atomically to the original payment method.
- **Affected:** `server/routes/returns.js`, ReturnsCenter page, transactions.
- **QA:** jest return-to-refund lifecycle (existing suites extended); E2E return request → label → refund.

### STORY 5.3 — Escrow transparency dashboard
As a buyer, I want to see my funds are held safely until delivery so that I trust the platform.
- Per-order escrow timeline (held → released), visible in OrderDetail; explanation of release rules.
- **AC:** order detail shows escrow state and release countdown; payout only after release.
- **Affected:** escrow route/page wiring, OrderDetail.

---

## EPIC 6 — Search, Discovery & Personalization (P1)

**Context:** server-side search exists with brand/color/size facets and saved searches. Client search is basic.

### STORY 6.1 — Faceted search & filters UX
As a shopper, I want to filter by category, price, condition, size, brand, location so that I find the right item fast.
- Faceted filter sidebar + sort (price, newest, trending); URL-encoded state for shareability; result count; empty state with suggestion.
- **AC:** filters combine correctly; deep-linking a filtered URL restores the exact view.
- **Affected:** `server/routes/search.js` (facets), Search.js.
- **QA:** E2E filter combination + URL restore.

### STORY 6.2 — Personalized feed
As a buyer, I want a feed that learns my taste so that I discover items I'll actually like.
- Taste profile from first-run onboarding (categories, sizes, styles), signals from views/likes/orders; feed re-ranks.
- **AC:** feed order changes based on signals; opt-out in Settings.
- **Affected:** Feed.js, new recommendation service, recentlyViewed/likes signals.
- **QA:** jest ranking sanity; E2E feed shows preferred category first after liking.

### STORY 6.3 — Similar items & "complete the look"
As a shopper, I want recommendations on listing pages so that I keep browsing.
- Similar listings (same category/brand/price band) + stylist picks; powered by existing `priceSuggestions`/AI data.
- **AC:** listing detail shows ≥4 relevant recommendations; clicks tracked.

---

## EPIC 7 — Viral & Social Commerce Loops (P1)

### STORY 7.1 — Social sharing with OG/meta tags (web)
As a seller, I want my listing/trend links to render rich previews when shared so that they go viral.
- SSR/prerender or dynamic meta tags for listing/trend/closet pages; OG image = product photo.
- **AC:** sharing a listing on X/WhatsApp shows title, price, image, link back.
- **Affected:** server-side meta injection or prerender service; ListingDetail, Trends.
- **QA:** manual share-card check; meta tag assertion in E2E (HTML response).

### STORY 7.2 — Offer-sharing & party/live-event referral verification
As a user, I want to invite friends to an offer/party and get credit when they buy so that growth is measurable.
- Verify `offerSharing`, `parties`, `liveEvents`, `referrals` end-to-end: unique links, attribution, reward credit.
- **AC:** referral credit appears after friend's first purchase; party host gets bonus on guest sales.
- **Affected:** existing routes/pages — audit + close gaps.
- **QA:** jest attribution; E2E invite → guest purchase → credit.

---

## EPIC 8 — Analytics, Observability & CI (P1)

### STORY 8.1 — CI pipeline (GitHub Actions)
As a team, I want tests to run automatically on every push so that regressions are caught instantly.
- Workflow: jest (server) + Playwright E2E (headless) on push/PR; artifacts on failure; required status check.
- **AC:** a failing test blocks merge; a green run posts a summary.
- **Affected:** `.github/workflows/ci.yml`; pin Playwright 1.49.1 + MONGOMS 7.0.14 in CI.
- **QA:** push a deliberate failing test to verify blocking, then revert.

### STORY 8.2 — Error monitoring & logging
As a team, I want to see production errors so that we fix them before users churn.
- Structured request logs, unhandled-error capture, alerting on 5xx spike; sanitize PII.
- **AC:** a thrown error in any route is logged with trace + user id (hashed); dashboard view for recent errors.
- **Affected:** server middleware, `server.js`.

### STORY 8.3 — Product analytics events
As a PM, I want to see funnel metrics so that I can improve conversion.
- Events: page_view, listing_view, add_to_cart, checkout_start, purchase, offer_sent/accepted, search.
- **AC:** events fire on the real flows; dashboard shows funnel conversion; no PII in events.

---

## EPIC 9 — Compliance, Security & A11y (P2)

### STORY 9.1 — Privacy: account deletion & data export
As a user, I want to delete my account and export my data so that I control my information.
- Settings: export (JSON) + delete account with confirmation; cascades or anonymizes user data per policy.
- **AC:** export returns all user-generated data; deletion removes PII within 30 days; orders preserved in anonymized form.
- **Affected:** users routes, Settings page, data policy doc.

### STORY 9.2 — Accessibility pass
As a user with a screen reader, I want to shop without barriers so that the marketplace is inclusive.
- Audit: keyboard nav, focus states, ARIA labels on forms/modals, color contrast, alt text, reduced-motion.
- **AC:** Lighthouse a11y ≥ 90 on home, listing, cart, checkout; keyboard-only flows work.
- **Affected:** global CSS, key components.
- **QA:** automated axe checks in E2E.

### STORY 9.3 — Security hardening audit
As a team, I want a documented security review so that we can ship with confidence.
- Rate limits on all auth + write endpoints, CSRF for state changes, dependency audit (`npm audit`), secret rotation runbook, security headers review.
- **AC:** `npm audit` clean (or documented exceptions); auth endpoints rate-limited; runbook in repo.
- **Affected:** server middleware, package.json, docs.

---

## EPIC 10 — Feature-Parity Verification of Social/Marketplace Extras (P2)

**Context:** AR Showrooms, Virtual Try-On, Video Shopping, Live Events, Auctions, Parties, Subscriptions, Loyalty, Cross-Border, Enterprise API, Fraud Protection all have pages+routes but **zero E2E coverage** and unknown depth. Several likely render as thin shells.

### STORY 10.1 — Deep audit + E2E for AR/Virtual Try-On/Video Shopping
As a user, I want these experiences to actually work so that the brand promise is real.
- Per feature: functional audit, stub removal, fallback when camera/AR unsupported, E2E smoke tests.
- **AC:** each feature has a working core path + graceful degradation + E2E coverage.

### STORY 10.2 — Auctions end-to-end
As a bidder, I want to place a bid and win so that auctions are trustworthy.
- Verify bid atomicity (concurrent bids), outbid notifications, auto-close, winner checkout handoff.
- **AC:** two concurrent bids keep the highest; winner can check out the won item; non-winners notified.
- **Affected:** `server/routes/auctions.js`, Auction pages.
- **QA:** jest concurrency test; E2E bid → win → checkout.

### STORY 10.3 — Subscriptions/Loyalty/Referrals value delivery
As a user, I want my subscription perks and loyalty points to apply so that they're worth having.
- Verify perk application (shipping, fees, points earning/spending) at checkout.
- **AC:** a subscriber sees perks reflected in order totals; points spend as partial payment.

---

## Immediate Next Actions (Architecture)
1. **P0 spike:** stripe test-mode wiring + webhook replay (Story 1.1) — unblocks full checkout E2E.
2. **P0 spike:** email service abstraction with template registry (Story 1.3).
3. **P1 spike:** realtime transport choice (Socket.IO vs SSE) against Render free-tier constraints (Story 3.1).
4. **CI first** (Story 8.1) — it de-risks every later story.
5. Gap-audit the six unverified social features (Epic 10) before investing in new UI.
