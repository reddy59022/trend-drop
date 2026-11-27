# Orphan Notification Alerting Runbook

The daily read-only integrity audit finds notifications inside `User.notifications`
that reference a transaction which no longer exists. Notifications are embedded
documents, so transaction deletion does not cascade to them.

The audit itself never mutates application data. It only persists alert
deduplication state in `NotificationAuditState` and sends operational
alerts over email or the configured webhook fallback.

## Schedule and code path

- Cron: daily at 05:00 server time (`0 5 * * *`) in `server/config/cron.js`.
- Audit: `server/utils/notificationAudit.js` (read-only).
- State/claim policy: `server/utils/orphanNotificationAlerts.js`.
- Alert transport: Brevo via `sendOperationalAlert` in `server/config/email.js`, with an optional webhook fallback (`ALERT_WEBHOOK_URL`).
- Manual read-only audit: `cd server && npm run notifications:audit-orphans`.

## Alert policy

A finding is the sorted, unique set of missing transaction IDs, SHA-256
fingerprinted. The alert includes the notification count, type breakdown,
affected-user count, missing IDs, and severity.

- The same fingerprint, same count, and same recipient configuration is
  suppressed for 7 days (`REMINDER_AFTER_MS`).
- An unchanged unresolved finding gets one weekly reminder after that window.
- A changed fingerprint, a larger notification count for the same fingerprint,
  or a changed recipient list alerts immediately.
- Severity is `CRITICAL` at `ORPHAN_ALERT_CRITICAL_THRESHOLD` notifications
  (default 10), otherwise `ALERT`.
- Delivery is claimed atomically in MongoDB with a 5-minute lease. Overlapping
  cron workers cannot both send the same alert. A crashed sender's lease
  expires and the next run can retry.
- Dedup state is written only after delivery succeeds. Skipped or failed sends
  leave the state eligible for retry.
- After a previously alerted finding returns to zero, one `[RECOVERY]` alert is
  sent under the same atomic claim. A second clean run sends nothing.
- Audit failures are deduplicated by failure fingerprint for 6 hours. A
  different error or an expired window pages again. If state is unreadable,
  alerting fails open.

### Environment and recipient scoping

Set `ORPHAN_ALERT_STATE_KEY` to a unique value per environment that shares a
MongoDB cluster:

```text
ORPHAN_ALERT_STATE_KEY=trend-drop-production
ORPHAN_ALERT_STATE_KEY=trend-drop-staging
```

If unset, the default key is `orphan-notifications`. Recipients come from
`ALERT_EMAILS`, then `ADMIN_EMAILS`, then `BREVO_SENDER_EMAIL`. The state stores
a hash of that recipient configuration; changing recipients causes the current
finding to be delivered to the new list.

## Metrics

`GET /metrics` exposes:

| Metric | Type | Meaning |
| --- | --- | --- |
| `trenddrop_orphan_notifications{source="cron"}` | gauge | Current orphan notification count from the last successful audit |
| `trenddrop_orphan_notification_audit_last_success_timestamp{source="cron"}` | gauge | Unix seconds of the last successful audit |
| `trenddrop_orphan_notification_audit_last_run_timestamp{source="cron"}` | gauge | Unix seconds of the last attempt, including failures |
| `trenddrop_orphan_notification_alert_last_sent_timestamp{source="cron"}` | gauge | Unix seconds of the last delivered alert/recovery |
| `trenddrop_orphan_notification_audits_total{result,source}` | counter | Audit outcomes: `clean`, `failed` |
| `trenddrop_orphan_notifications_total{result,source}` | counter | Notifications found when result is `found` |
| `trenddrop_orphan_notification_alerts_total{result,source}` | counter | Alert outcomes: `sent`, `suppressed`, `skipped`, `failed`, `recovery` |
| `trenddrop_operational_alert_delivery_total{result}` | counter | Alert delivery: `sent`, `failed`, `skipped`, `webhook_sent`, `webhook_failed` |
| `trenddrop_email_delivery_total{operation,result}` | counter | Brevo delivery across transactional/operational email |
| `trenddrop_email_retries_total{operation}` | counter | Bounded transport retries |

Recommended dead-man / freshness rules:

```yaml
- alert: OrphanNotificationAuditStale
  expr: time() - trenddrop_orphan_notification_audit_last_success_timestamp > 129600
  for: 10m
  labels: { severity: critical }
  annotations:
    summary: Orphan notification audit has not succeeded in 36 hours

- alert: OrphanNotificationsPresent
  expr: trenddrop_orphan_notifications > 0
  for: 15m
  labels: { severity: warning }
  annotations:
    summary: Dangling notification references are present

- alert: OrphanNotificationAlertDeliveryFailing
  expr: increase(trenddrop_operational_alert_delivery_total{result="failed"}[1h]) > 0
  labels: { severity: critical }
```

The 36-hour threshold allows for the daily schedule plus one missed run. A
stale run timestamp with no success timestamp means the job is failing or has
never completed; check Render logs and `/readyz`.

## Safe production verification

No database mutation and no audit trigger:

```bash
cd server
npm run notifications:test-alert          # dry run; prints recipient key
npm run notifications:test-alert:send     # sends one [TEST] email
```

The command exits non-zero if the transport is not configured. Use it after
changing `ALERT_EMAILS` / `ADMIN_EMAILS`, rotating `BREVO_API_KEY`, or verifying
a new deployment. `BREVO_TIMEOUT_MS` defaults to 10000; `BREVO_MAX_RETRIES` defaults to 2.

### Secondary paging path

Set `ALERT_WEBHOOK_URL` to a Slack incoming webhook or on-call automation
endpoint. If Brevo is unconfigured or all email attempts fail, the same alert
is posted as JSON:

```json
{ "source": "trenddrop", "subject": "[TrendDrop][ALERT] ...", "text": "..." }
```

Webhook delivery has its own timeout and bounded retry
(`ALERT_WEBHOOK_TIMEOUT_MS`, `ALERT_WEBHOOK_MAX_RETRIES`). A webhook success is
treated as delivered, so dedup state is recorded and the next run does not
re-alert. If both paths fail, the cron logs the email failure and the webhook
failure, records no dedup state, and retries on the next run.

## Inspect or reset dedup state

Read-only visibility is also available to admins at
`GET /api/admin/orphan-notifications/state`.

```bash
cd server
npm run notifications:state
npm run notifications:state:reset   # requires --confirm; deletes only state
```

Reset is appropriate when the recipient/transport was broken and the state is
believed to be stale. Resetting can cause the next audit to send an alert that
would otherwise have been suppressed. It does not delete notifications,
transactions, users, or audit history.

## Incident response

1. Confirm `/readyz` and `/metrics`; check the last success/run gauges.
2. Run the read-only audit and capture its JSON.
3. Identify whether the missing transaction is a QA fixture or real commerce.
   Never delete a real transaction merely to silence the alert.
4. For QA commerce, run the cleanup script: it removes every dependent
   notification before deleting the transaction and then runs the audit again.
   The shared transaction-deletion helper also verifies that no notification
   still references the deleted rows; otherwise it aborts the deletion.
5. For real commerce, preserve the transaction and remove only dangling
   notification documents through the approved data-repair process.
6. Verify `trenddrop_orphan_notifications` returns to 0 and a `[RECOVERY]`
   email arrives.
7. If email is down, use `notifications:test-alert:send` after fixing it; the
   unresolved finding remains eligible for retry because failed sends do not
   record dedup state.

## Failure matrix covered by tests

- unchanged finding: suppress
- weekly reminder: send once
- changed missing-ID set: send
- same IDs, larger orphan count: send
- overlapping audits: one atomic delivery
- delivery failure/skip: retry on a later run
- clean after alert: one recovery notice
- second clean run: no duplicate recovery
- audit failure: alert once, suppress identical retries
- post-QA-cleanup audit: zero residual orphans
- transaction deletion: verifies no dependent notification remains first
- metrics: current count and freshness gauges
- email primary + webhook fallback after provider failure
