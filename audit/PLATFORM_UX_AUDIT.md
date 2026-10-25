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
