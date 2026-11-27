# Transactional email sender setup (Brevo + Render)

## What the sender address is

Every transactional message (email verification, password reset, operational
alerts) is sent through Brevo by `server/config/email.js`. Two separate
addresses are involved:

| Field | Source | Purpose |
| --- | --- | --- |
| `sender` (From) | `BREVO_SENDER_EMAIL` | The address recipients see; Brevo only accepts senders verified on the account |
| `replyTo` | `CONTACT_EMAIL` (`connect.trenddrop@gmail.com`) | Where replies land |
| footer contact link | `CONTACT_EMAIL` | The public support address shown in the email body |

Keep them distinct. The From address has to be one Brevo will accept, while
replies and the public contact must stay `connect.trenddrop@gmail.com`.

## Behavior when `BREVO_SENDER_EMAIL` is unset

`server/server.js` calls `warnIfSenderNotConfigured()` at startup. When
`NODE_ENV=production` and `BREVO_SENDER_EMAIL` is missing or whitespace, the
process logs:

```
[email] BREVO_SENDER_EMAIL is not set in production — transactional email will be sent from <fallback>, not the public contact connect.trenddrop@gmail.com. Verify connect.trenddrop@gmail.com as a Brevo sender and set BREVO_SENDER_EMAIL in Render (server/docs/email-sender-setup.md).
```

Email still sends from the code fallback (`FALLBACK_SENDER_EMAIL` in
`server/config/email.js`) so a missing variable cannot break verification or
password reset. Outside production the check is silent.

## Step 1 — verify `connect.trenddrop@gmail.com` in Brevo

1. Sign in to Brevo with the account that owns `BREVO_API_KEY`.
2. Go to **Senders, Domains & Dedicated IPs → Senders**.
3. Choose **Add a sender**: From name `TrendDrop`, From email
   `connect.trenddrop@gmail.com`.
4. Brevo sends a confirmation link to that inbox. Open it and confirm; the
   sender stays pending and cannot send until it is confirmed.
5. Optional but recommended once a real domain exists: authenticate the domain
   (SPF/DKIM/Brevo code) and send from an address on it. A Gmail sender cannot
   be domain-authenticated, so expect Gmail-level deliverability until then.

## Step 2 — set the variable in Render

1. Render Dashboard → the `trend-drop` web service → **Environment**.
2. Add or edit `BREVO_SENDER_EMAIL` = `connect.trenddrop@gmail.com`.
   Leave `BREVO_API_KEY` unchanged.
3. Save. `render.yaml` declares this variable `sync: false`, so the dashboard
   value is the source of truth and the Blueprint does not overwrite it.
4. Saving triggers a deploy. Wait for it to go live (or use **Manual Deploy →
   Deploy latest commit** if nothing restarted).

## Step 3 — verify the change

1. Open the deploy logs and confirm there is no
   `[email] BREVO_SENDER_EMAIL is not set in production` line.
2. Trigger one message to an inbox you control (register a test account, or use
   "resend verification" on an account that is not verified).
3. Confirm the message arrives **From** `TrendDrop <connect.trenddrop@gmail.com>`
   with **Reply-To** `connect.trenddrop@gmail.com`.

## Rollback

If Brevo rejects the new sender (for example a 400 "sender not valid"), either
set `BREVO_SENDER_EMAIL` back to the previously verified sender or remove the
variable to use the fallback. Transactional email keeps flowing; the startup
warning reappears until a verified sender is configured.

## Tests

- `server/tests/emailSenderConfig.test.js` — production warning, configured
  sender, non-production silence, whitespace-only values.
- `server/tests/email.test.js` — footer contact link and `replyTo` use
  `connect.trenddrop@gmail.com`.
