# TrendDrop visual audit & rebrand

_Date: 2026-09-16_

## Product direction

**Promise:** Find what moves you.

TrendDrop is now positioned as a confident, global marketplace for standout style and thoughtful finds. The visual language uses electric plum for action and trust, warm coral for energy, and deep ink for editorial contrast.

## High-impact issues found

### Fixed

- Customer-facing branding was inconsistent: native metadata and public HTML said **TrendDrop**, while the navbar, footer, homepage, seller onboarding, referrals, order protection, and email verification UI said **AURAVEST**.
- The design system mixed violet, coral, teal, and legacy red values, so primary actions and badges did not feel like one product.
- The public app icon was a placeholder containing only a white circle and did not communicate the brand.
- Mobile navigation had too many competing controls in the top bar and could compress the search experience on narrow devices.
- Mobile tab items could become too wide for 320px devices when all authenticated destinations were visible.
- Shared interactive controls did not consistently guarantee comfortable native touch targets.
- Homepage headline and supporting copy described a premium-fashion-only product even though the marketplace includes broader categories.
- Several customer-visible commission/protection/referral strings used the old brand name.
- The shared JavaScript token mirror still diverged from CSS after the initial pass, and one commission gradient had collapsed to a flat color.

### Addressed in this pass

- Unified customer-facing brand to **TrendDrop**.
- Updated homepage message to **Find what moves you** and broadened product language.
- Rebuilt shared color tokens around plum/coral/ink and updated the token mirror used by JS.
- Replaced the placeholder web icon with a recognizable TD monogram.
- Updated Android adaptive launcher background and foreground artwork to the TD monogram.
- Added mobile header prioritization: search stays usable, locale controls move out of the cramped header, and safe-area padding is preserved.
- Added narrow-phone tab-bar sizing for 320–380px devices.
- Standardized 44px minimum tap targets for shared navigation and card actions.
- Aligned the JavaScript token mirror, profile fallback avatar, boost cards, commission gradient, and native OAuth example with the TrendDrop system.
- Refined listing cards with stable mobile hierarchy, 44px quick actions, keyboard focus treatment, accessible labels, seller-name truncation, and broken-image fallback handling.
- Removed an unused icon import and stale referral URL locals in touched screens.

## Platform acceptance checklist

- Web production build: **passes**.
- Client tests: **85 suites / 415 tests pass**; focused listing-card/mobile navigation tests: **5/5 pass**.
- Server validation: representative suites pass, including accessibility (12 tests), websocket (11), end-to-end (197), payment/concurrency (10), and hardening (92); the complete serial suite exceeds the 10-minute execution window in this environment and needs a longer CI allowance.
- Android Gradle build: **passes** with Java 21 and Android SDK 35.
- Android APK validation: **passes**; package `com.trenddrop.app`, label `TrendDrop`, APK signature verified.
- Android emulator: SDK emulator and API 35 AVD were installed, but this older x86 macOS host cannot complete the emulator boot within the QA window; logs show software TCG fallback and no usable hardware acceleration.
- iOS native build: **not run** — requires Xcode signing/device environment.
- Browser E2E QA: **19 flows passed** across geo/currency, buyer checkout/cancellation, mobile preferences/push, social commerce, video shopping, virtual try-on, AI stylist, and AR showrooms using the hermetic Chromium setup. Full visual regression coverage at every breakpoint remains outstanding.

## Remaining P0/P1 quality work

1. Generate and install the final 1024px TrendDrop icon into the iOS `AppIcon.appiconset` PNG asset and regenerate all Android density assets from the same source of truth.
2. Java 21 and Android SDK/emulator tooling are now installed user-locally; the debug build passes. A hardware-accelerated host or physical Android device is still needed for runtime validation of status-bar contrast, keyboard resize, back navigation, permission prompts, deep links, push permissions, and system theme.
3. Run Xcode builds on a signing-capable Mac; validate safe areas, notch/island layout, keyboard dismissal, universal links, APNs prompts, and App Store launch assets.
4. Expand Playwright/device visual checks at 320, 375, 390, 768, 1024, and 1440px; the current browser pass covers functional flows but not a complete breakpoint screenshot matrix.
5. Continue improving the test harness warning output: production ESLint warnings are now cleared; remaining client test output is primarily intentional error-path logging and async `act()` notices, while the full server suite needs a longer CI allowance than the local 10-minute window.
6. Review long-tail page consistency: seller/admin tables, checkout, listings, auction flows, chat, search filters, and all empty/error/loading states.
7. Complete accessibility validation with keyboard, VoiceOver/TalkBack, contrast, reduced motion, dynamic text sizing, and screen-reader announcements on async actions.

## Release recommendation

The shared brand/shell pass is safe to merge after native build verification. Do not market the app as “100% issue-free” until the native icon assets, Android/iOS builds, browser/device visual checks, and warning cleanup above are complete.
