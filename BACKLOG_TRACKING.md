# BACKLOG TRACKING — Trend-Drop Marketplace

_Source of truth for story status. Read this FIRST every day at startup._
_Last sync: 2026-08-10 20:05 CDT · Baseline: jest 1101/1101 (83 suites) · E2E 25/25 · Render live & healthy · CI run #4 GREEN (31417224258) · TD-8.1 Accepted · TD-2.1 local verify done (unsigned+signed), CI verify queued_

---

## 1. Daily Ritual (run at every system start, via cron wake)

1. **Read this file** (statuses, active story, blockers) + latest `memory/*.md`.
2. **Verify baseline** (cheap checks): `git status` clean-or-known, `git log --oneline -1`, `curl https://trend-drop.onrender.com/health`.
   - If a previous day left tests red, that is the #1 priority — fix before any new story.
3. **Select next story**: highest priority (`P0 → P1 → P2`), earliest, no blocker. Confirm the plan with the affected roles (Architecture → Frontend/Backend → QA).
4. **Execute to Definition of Done** (below). Drive each role's step; do not move on until tests prove the story.
5. **Accept or escalate**: update this file (status, evidence, date), update `memory/`, send Sunny a summary. Only mark **Accepted** when the DoD gate passes.
6. If blocked >1 day: mark **Blocked** with reason + what unblocks it, and report.

## 2. Definition of Done — the acceptance gate

A story is **Accepted only when ALL** hold:

- [ ] Implementation complete (client + server + db as scoped in the story)
- [ ] New/updated **jest tests pass**; full server suite stays green (≥1084, 0 failures)
- [ ] New/updated **Playwright E2E passes**; full suite stays green (≥25/25)
- [ ] `client` production build passes (`npm run build`)
- [ ] Code review done: diff reviewed, security scan (no secrets, no exposed data, auth intact)
- [ ] Committed + pushed to `main` (descriptive message, no force push)
- [ ] Render deploy triggered **and verified** (health + story-specific flow) when the story changes prod behavior
- [ ] Tracker updated: status `Accepted`, test evidence + date logged

## 3. Status legend

`Backlog` → `In Progress` (owner role + start date) → `In QA` → `Accepted` | `Blocked` (reason)

## 4. Active / Next

| Story | Title | Status | Owner | Notes |
|---|---|---|---|---|
| **TD-1.1** | Stripe test-mode payments | **In Progress** | Backend/QA | Code-complete + security-reviewed (888f492); jest 1101/1101, E2E 25/25+1 skip (6903685); ⏳ live verify queued on Sunny's Stripe TEST keys |
| **TD-2.1** | Signed Android release build + CI artifact | **In QA** | DevOps | Key-gated signing in app/build.gradle + android-release CI job; local verify: unsigned APK 7.7MB + signed APK (apksigner cert verified, versionCode stamp) ✅; CI verify queued on next push |

## 5. Full Story Tracker (31 stories / 10 epics)

| ID | Story | Epic | Pri | Size | Status | Owner | Test evidence | Accepted |
|---|---|---|---|---|---|---|---|---|
| TD-1.1 | Real payment processing (Stripe test mode) | 1 | P0 | L | **In Progress** | Backend | jest 1101/1101 incl. WH.1–WH.6 (888f492); E2E 25/25 + key-gated 4242 card spec (6903685); live check blocked on Stripe keys | – |
| TD-1.2 | Functional media uploads (Cloudinary) | 1 | P0 | M | **In QA** | Frontend | Upload routes + mocked SDK tests (imageUpload, boost) green; ⏳ live verify queued on Cloudinary keys | – |
| TD-1.3 | Verification & transactional email (Brevo/SMTP) | 1 | P0 | M | **In QA** | Backend | New EM.1–EM.7 suite on real config/email.js logic (c3515cd); ⏳ live verify queued on Brevo key | – |
| TD-1.4 | Social sign-in (Google/Apple/Facebook) | 1 | P0 | L | **In QA** | Frontend | SOCIAL.1–10 cover Apple, Facebook + Google create/link/validate (c3515cd); ⏳ live verify queued on Google/Apple/FB client ids | – |
| TD-2.1 | Signed Android release build + CI artifact | 2 | P0 | M | **In QA** | DevOps | Key-gated signing (env/Gradle props: TRENDDROP_KEYSTORE_PATH/BASE64/PASSWORD, KEY_ALIAS, KEY_PASSWORD, VERSION_CODE/NAME) + `android-release` CI job (needs: test, uploads APK artifact); local: unsigned 7.7MB + signed 7.8MB APK, apksigner cert verified | – |
| TD-2.2 | iOS build pipeline | 2 | P0 | M | Blocked | DevOps | needs full Xcode machine | – |
| TD-2.3 | Push notifications (FCM + APNs) | 2 | P0 | L | Backlog | Backend | – | – |
| TD-2.4 | Deep links & native redirect URIs | 2 | P0 | M | Backlog | Frontend | – | – |
| TD-2.5 | Biometric unlock | 2 | P0 | M | Backlog | Frontend | – | – |
| TD-3.1 | Real-time chat (socket/SSE + fallback) | 3 | P1 | L | Backlog | Backend | – | – |
| TD-3.2 | Offer negotiation from chat | 3 | P1 | M | Backlog | Frontend | – | – |
| TD-4.1 | Listing & user moderation console | 4 | P1 | M | Backlog | Backend | – | – |
| TD-4.2 | Dispute resolution workflow UI | 4 | P1 | L | Backlog | Backend | – | – |
| TD-4.3 | Content moderation (trends/social) | 4 | P1 | M | Backlog | Frontend | – | – |
| TD-5.1 | Post-purchase photo reviews | 5 | P1 | M | Backlog | Frontend | – | – |
| TD-5.2 | Returns & refund UX with tracking | 5 | P1 | L | Backlog | Backend | – | – |
| TD-5.3 | Escrow transparency dashboard | 5 | P1 | S | Backlog | Frontend | – | – |
| TD-6.1 | Faceted search & filters UX | 6 | P1 | M | Backlog | Frontend | – | – |
| TD-6.2 | Personalized feed | 6 | P1 | L | Backlog | Backend | – | – |
| TD-6.3 | Similar items / complete-the-look | 6 | P1 | M | Backlog | Backend | – | – |
| TD-7.1 | Social sharing with OG/meta tags | 7 | P1 | M | Backlog | Frontend | – | – |
| TD-7.2 | Offer-sharing/referral attribution verification | 7 | P1 | L | Backlog | QA | – | – |
| TD-8.1 | CI pipeline (GitHub Actions) | 8 | P1 | M | **Accepted** | DevOps | CI run #4 green (31417224258): jest 1084/1084, build OK, E2E 25/25 on GitHub Actions | 2026-08-10 |
| TD-8.2 | Error monitoring & structured logging | 8 | P1 | M | Backlog | Backend | – | – |
| TD-8.3 | Product analytics events | 8 | P1 | M | Backlog | Frontend | – | – |
| TD-9.1 | Privacy: account deletion & data export | 9 | P2 | M | Backlog | Backend | – | – |
| TD-9.2 | Accessibility pass (a11y ≥90) | 9 | P2 | L | Backlog | Frontend | – | – |
| TD-9.3 | Security hardening audit | 9 | P2 | M | Backlog | Security | – | – |
| TD-10.1 | AR/VirtualTryOn/VideoShopping audit + E2E | 10 | P2 | L | Backlog | QA | – | – |
| TD-10.2 | Auctions end-to-end (concurrency) | 10 | P2 | L | Backlog | Backend | – | – |
| TD-10.3 | Subscriptions/Loyalty/Referrals delivery | 10 | P2 | L | Backlog | QA | – | – |

## 6. Completion log (append-only)

| Date | Story | Result | Evidence | Deploy |
|---|---|---|---|---|
| 2026-08-09 | Baseline (pre-sprint) | Cert | jest 1084/1084 (81 suites); Playwright 25/25; live `/health` ok | live |
| 2026-08-10 | TD-8.1 CI pipeline | Accepted | CI run #4 green (31417224258, commit 6f4d4e6): jest 1084/1084, client build OK (eslint warnings non-blocking), Playwright 25/25 | live |
| 2026-08-10 | TD-1.1 prep | Verified | Security hardening + key-gated E2E committed (888f492, 6903685); local jest 1101/1101, Playwright 25/25 + 1 key-gated skip; Render `/health` ok. Live card checkout still queued on Stripe TEST keys | live |
| 2026-08-10 | TD-1.3/TD-1.4 test hardening | In QA | c3515cd: email module suite EM.1–EM.7 (keyless skip, keyed send, URL fallbacks) + Google OAuth SOCIAL.7–10; jest 1101/1101 (83 suites), no prod code touched | live |
| 2026-08-10 | TD-2.1 local verify | In QA | Key-gated signing + CI android-release job; local builds: unsigned app-release-unsigned.apk 7.7MB, signed app-release.apk 7.8MB (apksigner cert CN=TrendDrop CI Test, v2/v3 verified, versionCode 42/versionName 1.0-test stamped); signing activates via GitHub secrets KEYSTORE_BASE64/KEYSTORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD — key-independent, CI verify queued | n/a (build-only) |
