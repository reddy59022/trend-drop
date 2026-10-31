# TrendDrop — Platform UI/UX Audit: Web · iOS · Android (25 Oct 2026)

Full audit of **all 65+ pages** (`client/src/pages` — 68 entries incl. page CSS +
tests) and the shared component/CSS stack against three standards at once:
**WCAG 2.2 (web)**, **Apple HIG (iOS)** and **Material 3 (Android)**. The app is
one React codebase shipped three ways (web SPA + Capacitor iOS/Android), so the
platform standards are enforced in the shared CSS/JS layers and apply to every
page on every platform.

Companion to `PAGE_AUDIT.md` (content/a11y battery, 63 pages) and
`PRODUCTION_AUDIT.md` (functional matrix). This pass covers the **platform
standard** dimension those did not: chrome colour, hardware navigation, touch
targets, text floors, zoom behaviour and viewport units.

## 1. Audit battery — results before → after

| # | Standard | Finding before | Fix | After |
| --- | --- | --- | --- | --- |
| 1 | WCAG 1.4.4 / HIG / Material — pinch zoom | `viewport` meta had `maximum-scale=1, user-scalable=no`: pinch-zoom blocked site-wide (store accessibility review reject) | Removed; kept `viewport-fit=cover` (notch support) | Zoom enabled everywhere |
| 2 | Android 12+ / iOS 15+ chrome theming | `theme-color` was `#E24455` — a stale pre-rebrand red clashing with the violet brand and both themes | Meta now matches the surface under the glass navbar and updates with the theme (`#FFFFFF` / `#08081A`) via `ThemeContext` | Chrome blends with app in both themes |
| 3 | Native status bar (iOS/Android) | `setStatusBarColor` existed but was never called — status-bar icon style never followed the theme (dark-on-dark) | Wired into the theme effect; style flips LIGHT/DARK with theme | Status bar legible in both themes |
| 4 | Android navigation standard | `@capacitor/app` had **no `backButton` listener** — hardware/gesture back killed the app instead of stepping the SPA history | Back now walks WebView history, minimizes to launcher at root (standard Android behaviour); listeners cleaned up on unmount incl. add/remove races | Back behaves natively |
| 5 | iOS auto-zoom on focus | Handled at ≤768px already (design-haul 5/6) | Verified intact — inputs 16px on mobile | OK |
| 6 | iOS 11pt / Android 12sp text floor | **26 spots below the floor** (9–10px): tab-bar labels, count badges, chat timestamps, "Cover"/"Negotiated"/"RECOMMENDED" chips, inline status chips across 12 files | All floored to 11px; tab-bar padding/min-width tightened so the 6-tab dock still fits 320px | 0 below floor |
| 7 | iOS 44pt / Android 48dp touch targets | Icon buttons rendered at 30–38px (`.comment-delete` 32px, `.star-btn` 34px, icon buttons 36px) | App-wide `@media (pointer: coarse)` floor of 44px on `button/[role=button]/.btn/select/…` in design-haul (5/6), plus a layer-6 override so `.comment-delete`/`.star-btn` comply; desktop (fine pointer) keeps compact sizes | 44px floor on touch |
| 8 | iOS Safari dynamic toolbar / `100vh` jank | `100vh` without `dvh` fallback in 4 places (`.app`, `.loading-screen`, page shells, modal max-height) | `100dvh` fallback added after each `100vh` | No toolbar jank |
| 9 | Reduced motion | Universal `prefers-reduced-motion` rule in globals (1/6) | Verified covers all layers | OK |
| 10 | Safe areas (notch/home indicator) | `env(safe-area-inset-*)` tokens + navbar/tab-bar/footer handling present | Verified | OK |
| 11 | Emoji as UI icons (HIG/Material iconography) | **17 leftovers** the prior pass missed (`📊👕🔐🏪📩📤⚡🛡🚩🔔👁🎪💝👋` in 11 files) | All replaced with the `react-icons/fa` set (existing convention), except share-copy text (Referrals), country-flag glyphs (Navbar) and typographic ✓ marks — all legitimate | 0 improper emoji |
| 12 | RTL / i18n | `lang`/`dir` set from ThemeContext; RTL rules in globals | Verified | OK |

## 2. Files changed (33)

**Platform chrome / navigation**
- `client/public/index.html` — viewport zoom fix, theme-color
- `client/src/context/ThemeContext.js` — dynamic theme-color + native status-bar
- `client/src/App.js` — Android `backButton` handling (history → minimize)

**CSS stack (respecting the 6-layer ownership banners)**
- `styles/design-haul.css` (5/6) — coarse-pointer 44px touch-target floor
- `styles/dashboard-bespoke.css` (6/6) — `.comment-delete`/`.star-btn` floor
- `styles/append-to-app.css`, `App.css` — 9–10px → 11px text floor, tab dock
  sizing, `100dvh` fallbacks
- `styles/globals.css`, `styles/responsive.css` — `100dvh` fallbacks

**Per-page/per-component (emoji → icon set, sub-floor text)**
- Pages: Cart, Closet, ForgotPassword, FraudProtection, Messages, Notifications,
  OfferSharing, Offers, Parties, Profile, RecentlyViewed, ResetPassword, Search,
  Sell, SellerDashboard, Transactions, Trends, Wishlist
- Components: ChatModal, CounterOfferModal, ImageCarousel, MediaCarousel,
  OfferModal, ShopBoostCard

## 3. Verification

| Check | Result |
| --- | --- |
| Client unit tests (`CI=true react-scripts test`) | **598/598 pass** (108 suites) |
| Production build (`npm run build`) | **Pass** (clean) |
| In-memory browser E2E (Playwright, 294 scenarios) | **287 pass**; 7 fail — see below |
| Server deps / lockfiles | `npm ci` clean on root, client, server; no lockfile changes |

The 7 E2E failures (6× `24-geo-currency`, 1× `17-social` browser comment flow)
are **browser-rendering tests that fail identically on the untouched baseline**
(verified by `git stash` + rebuild + rerun). Root cause is environmental: this
sandbox's headless Chromium crashes its renderer process on *any* page render
(verified standalone on `/` and `/login`, with all missing shared libraries
supplied and multiple launch-flag sets). The API-level E2E layers all pass.
Re-run the browser suite on a machine with a normal browser stack for a full
green run.

## 4. Remaining items (out of scope / external)

1. Browser E2E rerun on a healthy machine (above).
2. The earlier passes' open items still stand: production QA-catalog cleanup
   (awaits go-ahead), listing photography (data), CRA → Vite migration
   (tooling advisories), live money flows (need Stripe test keys).
3. Platform-native niceties not reachable without device tooling: App Store /
   Play Store screenshot sets, native splash animation, iPad layout tuning.

## Platform shell addendum — install/metadata pass (this session)

Full page-level audit re-run across all 66 routes: pages share a hardened
baseline (alt text, aria labels, confirm-modals via ConfirmContext, safe-area
insets, theme-synced `meta[theme-color]` + native status bar, numeric
keyboards) — no per-page regressions found. The remaining gap was the
installable web-app layer, fixed:

1. `client/public/manifest.json` — name/short_name, standalone display,
   start_url/scope, 5 icons (SVG any, 192/512 any PNG, maskable 512).
   Regenerable via `scripts/generate-app-icons.cjs` (pure-JS rasterizer of
   `app-icon.svg`, no browser/image tooling needed).
2. `client/public/index.html` — manifest link, `mobile-web-app-capable`,
   `apple-mobile-web-app-{capable,title,status-bar-style}`, apple-touch-icon
   (180 full-bleed PNG; iOS composites its own corners), SVG+PNG favicons,
   OG/Twitter share-card meta, `fonts.gstatic.com` preconnect (crossorigin).
3. Native iOS/Android icon assets (xcassets / mipmap) already existed and are
   unchanged — the gap was web-only.

Verified: `CI=true npm test` 111 suites / **613 tests pass**;
`npm run build` clean and ships `build/manifest.json` + `build/img/icons/*`.

## Visual design QA — real-screenshot pass (design-haul layer)

Screenshot review (Playwright headless, `scripts/design-screens.cjs`) of
home/search/feed across light+dark, desktop+mobile. Two real rendering
defects found and fixed in `client/src/styles/design-haul.css` (layer 5/6):

1. Light-mode hero contrast — the headline stayed the dark-theme white and
   the serif "Extraordinary" gradient ended in #fff, leaving both
   near-invisible on the pearl aurora background (white-on-lavender). Fix:
   `[data-theme="light"] .hero-content h1` flips to ink
   (`--td-secondary`) and the serif gradient to a deep-amber ramp
   (#92400E → #E89B3C → #B45309) that keeps the champagne-gold brand
   within AA contrast. Verified on re-screenshot (desktop + mobile).

2. Login card geometry — Login.js composes `auth-card glass-card`, a
   combination no layer ever sized. The card rendered with zero padding
   while `.glass-card` clips overflow: the "Welcome Back" h1 was cut off at
   the top and inputs pressed into the card edges. Also, `#root div
   { max-width: 100% }` (responsive.css element-hack) beat any plain class
   cap, so the card stretched full-bleed at 1400px. Fix: `.auth-card` sized
   as a proper glass container (padding, centered text) with the 460px cap
   written as `#root .auth-card` so it outranks the element-hack. Verified
   on re-screenshot.

Dark mode (home + browse) reviewed clean — no changes needed. Session
tooling: `artifacts/session-tools/*.cjs` (screenshot + CSS cascade trace).

Verified: `CI=true npm test` 111 suites / **613 tests pass**; `npm run
build` clean.

## Full-route screenshot sweep (all remaining pages)

Second pass (`artifacts/session-tools/qapages.cjs`, `qamobile.cjs` + fix
re-shots): 25 desktop routes × dark+light and 7 mobile routes × dark+light,
logged in as the seeded E2E buyer, real Chromium captures in
`artifacts/shots/`. All buyer/seller surfaces reviewed page by page.
Findings and fixes (all in `client/src/styles/design-haul.css`, one tiny
class-hook edit in `client/src/pages/Cart.js`):

1. **Seller Analytics page rendered UNSTYLED** (worst defect in the app) —
   `SellerAnalytics.js` ships a full class vocabulary (`period-selector`,
   `metrics-grid`, `metric-card`, `charts-row`, `activity-item`, …) that no
   CSS layer ever styled; the page was raw stacked text. Fix: complete
   analytics stylesheet added to the design-haul layer — glass stat cards
   with gradient medallions, pill period-selector with gradient active
   state, chart/recent-activity cards, `no-data` empty states; 3-col→2-col→
   1-col responsive grids with tuned phone typography. Verified desktop
   dark+light AND mobile.

2. **Forgot-password card stretched edge-to-edge** on desktop —
   `ForgotPassword.js` uses `.auth-container` with no width cap (Register
   gets an inline 480px, Login has `.auth-card`), and `#root div
   { max-width: 100% }` beat any earlier cap. Fix: `#root .auth-container
   { max-width: 460px; margin-inline: auto }` (ID+class outranks the
   element-hack). Verified logged-out re-screenshot.

3. **Cart item rows collapsed on phones** — the inline-styled flex row
   (image + title + qty stepper + price + remove) overflowed 390px; the
   stepper broke apart behind the title. Fix: class hooks
   (`cart-item-row/-info/-qty/-price/-remove`) on the row in `Cart.js` +
   design-haul rule that wraps ≤640px into two clean lines (title row, then
   right-aligned stepper/price/remove; `!important` needed because the row's
   inline `flex: 1` sets flex-basis 0%). Verified mobile re-screenshot.

4. **Floating tab dock too translucent** — `--td-glass-bg` (72% alpha)
   let page text read straight through the dock where backdrop-filter is
   weak/unsupported (mobile listing/cart/dashboard captures). Fix: near-solid
   dock background on ≤768px (dark 92% / light 94%), both themes verified.

5. Navbar "US · USD" prefs pill now has breathing room from the hamburger
   on phones.

Bottom-clearance audit: `.main-content` correctly reserves 84px+safe-area
for the dock (footer clears it); the "text behind the bar" in single-frame
captures is ordinary scroll-under, not overlap. Register captures during
the sweep rendered Home because logged-in users are redirected off auth
routes — register/forgot re-verified logged out.

Not changed (reviewed, already clean): sell, dashboard, profile, offers,
transactions, messages, notifications, settings, AI stylist, trends, live
events, virtual try-on, size recommendation, subscriptions, referrals,
returns, wishlist, reviews, legal, inventory.

Verified: `CI=true npm test` 111 suites / **613 tests pass**; `npm run
build` compiled successfully.

## Remaining-gaps cleanup (follow-up to full sweep)

1. **Cart qty controls line** — previously reflowed via `margin-left: auto`,
   which floated the stepper mid-air with uneven gaps at 390px. Measured the
   real geometry: row content is 324px and tap-size rules force stepper
   buttons and the remove button to 44px each (mine/plus/`×` are 128px + remove
   44px), so the planned 84px info-column indent (353px demand) overflows and
   pushed remove onto a third line. Now the stepper left-aligns (8px) and
   price + remove right-align — one tidy line, re-screenshotted dark mobile.
2. **Size Recommendation result card** — replaced the inline full-bleed
   `var(--td-primary)` slab with a themed glass result: gradient size badge,
   title + confidence line, and a bounded meter (`size-result*` classes in
   `design-haul.css`, light/dark tokens, ≤480px tightening). Fixed the
   underlying empty-state bug: a stale GET record with no size and 0% confidence
   used to paint a blank badge and a "Size ␣ recommended" placeholder; the card
   now renders only when `recommendedSize` exists (verified both the empty
   record hides, and the saved flow shows "Size S / Confidence 85%").

Verified: `CI=true npm test` 111 suites / **613 tests pass**; `npm run
build` compiled successfully.
