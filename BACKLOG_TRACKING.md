# BACKLOG TRACKING — Trend-Drop Marketplace

_Source of truth for story status. Read this FIRST every day at startup._
_Last sync: 2026-08-09 21:10 CDT · Baseline: jest 1084/1084 · E2E 25/25 · Render live & healthy_

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
| **TD-8.1** | CI pipeline (GitHub Actions) | **In Progress** | DevOps | Workflow written; local verification passed (jest 1084/1084, build OK, E2E 25/25); ready for commit/push |
| TD-1.1 | Stripe test-mode payments | Next after CI | Backend/QA | Unblocks full checkout E2E |

## 5. Full Story Tracker (31 stories / 10 epics)

| ID | Story | Epic | Pri | Size | Status | Owner | Test evidence | Accepted |
|---|---|---|---|---|---|---|---|---|
| TD-1.1 | Real payment processing (Stripe test mode) | 1 | P0 | L | Backlog | Backend | – | – |
| TD-1.2 | Functional media uploads (Cloudinary) | 1 | P0 | M | Backlog | Frontend | – | – |
| TD-1.3 | Verification & transactional email (Brevo/SMTP) | 1 | P0 | M | Backlog | Backend | – | – |
| TD-1.4 | Social sign-in (Google/Apple/Facebook) | 1 | P0 | L | Backlog | Frontend | – | – |
| TD-2.1 | Signed Android release build + CI artifact | 2 | P0 | M | Backlog | DevOps | – | – |
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
| TD-8.1 | CI pipeline (GitHub Actions) | 8 | P1 | M | **In Progress** | DevOps | jest 1084/1084, E2E 25/25, client build OK | – |
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
