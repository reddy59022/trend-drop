# EasyPost sandbox with Stripe Connect

## Architecture

TrendDrop has two separate provider responsibilities:

| Concern | Provider | Owner |
| --- | --- | --- |
| Seller onboarding, payouts, transfers | Stripe Connect | Platform marketplace |
| Rates, postage, labels, tracking | EasyPost | Platform marketplace |

Stripe Connect does **not** issue shipping labels or provide carrier tracking.
There is no Stripe credential that can be passed to EasyPost. The marketplace
therefore keeps **one platform-owned EasyPost account** and uses each seller's
Stripe Connect account only to receive earnings.

The existing seller connection flow is:

- `GET /api/payments/connect/status`
- `POST /api/payments/connect/onboard` (creates/resumes an Express account)

Shipping is already platform-controlled: checkout buys the label with the
platform EasyPost account before capture, and sellers never receive postage or
supply carrier credentials.

## Configuration

Never create a separate EasyPost account for a seller or a marketplace tenant.

```dotenv
# Use the existing TrendDrop EasyPost account.
EASYPOST_MODE=production       # production | sandbox | test
EASYPOST_API_KEY=...           # production key, used when mode=production
EASYPOST_TEST_API_KEY=...      # EasyPost Test key, used when mode=sandbox/test
EASYPOST_WEBHOOK_SECRET=...    # HMAC secret on the EasyPost tracker webhook
```

`EASYPOST_MODE=sandbox` (or `test`) selects `EASYPOST_TEST_API_KEY` only. It
never falls back to the production key. The mode is refused on a live Stripe
deployment (`NODE_ENV=production` with `sk_live_...`), so a test label cannot be
purchased for a real order.

`GET /api/shipping/provider` returns safe readiness:

```json
{
  "provider": "easypost",
  "mode": "sandbox",
  "platformManaged": true,
  "payoutRail": "stripe_connect",
  "configured": true,
  "webhookConfigured": true
}
```

## One shipment state machine

`server/services/shipmentTracking.js` is the single transition authority for
outbound orders. The EasyPost tracker webhook, the signed carrier webhook, the
polling job, mock delivery, and the sandbox driver all call
`applyOutboundTrackingEvent`. Tests therefore exercise the same mapping and
terminal-state rules as production.

Carrier milestones are mapped to transaction lifecycle states as follows:

| Carrier milestone | Lifecycle state |
| --- | --- |
| `picked_up` | `shipped` |
| `in_transit` | `in_transit` |
| `in_transit_local` | `in_transit` |
| `out_for_delivery` | `out_for_delivery` |
| `delivered` | `delivered` |
| `returned` | `returned` |
| `exception` | unchanged; recorded in history |

Late or out-of-order scans are acknowledged but cannot move a terminal order
backwards. A replay after `buyer_confirmed` or `completed` cannot undo receipt
confirmation.

## Full shipment lifecycle in sandbox

Authenticated buyers and sellers can advance a shipment through every outbound
state without a real carrier scan. The endpoint is available only when the
provider is in mock or sandbox mode and is intentionally absent on live
production.

```bash
curl -X POST "$BASE_URL/api/shipping/sandbox/advance" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"transactionId":"...","status":"picked_up"}'
```

Supported states:

`label_created` → `picked_up` → `in_transit` → `in_transit_local` →
`out_for_delivery` → `delivered`

`exception` is recorded for support without regressing the order. `returned`
moves the order to the terminal returned state. Unauthorized participants get
`403`; invalid transitions get `400`.

For return labels, the signed carrier webhook remains
`POST /api/shipping/tracking-event` with `returnId` and
`x-tracking-secret`.

## Webhooks

Configure the EasyPost Test webhook to:

```text
POST https://<host>/api/shipping/easypost-webhook
```

EasyPost does **not** generate the signing secret. You choose it when creating
the webhook and must set the exact same value as `EASYPOST_WEBHOOK_SECRET` in
the deployed environment. Create the Test webhook against the existing
platform account (never create a seller account):

```bash
curl -X POST https://api.easypost.com/v2/webhooks \
  -u "$EASYPOST_TEST_API_KEY:" \
  -H 'Content-Type: application/json' \
  -d '{
    "webhook": {
      "url": "https://<host>/api/shipping/easypost-webhook",
      "webhook_secret": "<same value as EASYPOST_WEBHOOK_SECRET>"
    }
  }'
```

The endpoint accepts EasyPost's `X-Hmac-Signature` in the SDK wire format
`hmac-sha256-hex=<digest>` and verifies the raw body. In
EasyPost Test mode, a test tracker emits one event in a supported state;
production emits the full carrier progression. The webhook is idempotent and
forward-only.

### Daily reconciliation (webhook safety net)

Webhooks are best-effort, so the server also polls every active label once a
day (`config/cron.js`, 01:15 server time, via
`services/outboundTrackingSync.js`). It covers transactions in
`shipped`, `in_transit` and `out_for_delivery` that have a `shipping.trackerId`,
fetches the tracker from EasyPost and applies the same forward-only rules as
the webhook. It never advances a shipment from a timer, never regresses a
state, uses the carrier scan's own timestamp/location, skips `pre_transit` and
unknown statuses, and isolates a failing tracker so the rest of the batch
still runs. The job is idempotent, so overlapping runs are safe. Set
`EASYPOST_TEST_API_KEY` (sandbox) or `EASYPOST_API_KEY` (live) for it to work.

Verify a signed event locally without contacting EasyPost:

```bash
cd server
NODE_ENV=test npx jest --runInBand --forceExit tests/easypostWebhook.test.js
```

That suite signs a `tracker.updated` payload with the same HMAC format EasyPost
uses, walks `in_transit` → `available_for_pickup` → `out_for_delivery` →
`delivered`, and proves late scans cannot undo buyer confirmation.

## Verification

```bash
cd server
NODE_ENV=test npx jest --runInBand --forceExit tests/easypostSandbox.test.js tests/easypostShipping.test.js tests/easypostWebhook.test.js tests/trackingWebhook.test.js
```

Production rollout requires a real `EASYPOST_API_KEY`, `EASYPOST_MODE=production`,
and `EASYPOST_WEBHOOK_SECRET`. A missing key fails closed before capture.
