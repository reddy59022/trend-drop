// Brevo (formerly Sendinblue) email configuration
//
// Transport: plain fetch to Brevo's v3 REST API (Node >= 18). This replaces
// the deprecated @sendinblue/client SDK, whose request@2.88.2 dependency
// chain carried CRITICAL advisories (request SSRF, form-data boundary/CRLF)
// plus moderate ones (qs, tough-cookie, uuid@3).
const crypto = require('crypto');
const { increment } = require('../utils/metrics');
const { CONTACT_EMAIL } = require('./contact');

const retryLimit = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(0, Math.min(Math.floor(parsed), 5));
};

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SMTP_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_TIMEOUT_MS = Math.max(1000, Number(process.env.BREVO_TIMEOUT_MS) || 10000);
const BREVO_MAX_RETRIES = retryLimit(process.env.BREVO_MAX_RETRIES);
const RETRY_BASE_MS = Math.max(50, Number(process.env.BREVO_RETRY_BASE_MS) || 250);
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;
const ALERT_WEBHOOK_TIMEOUT_MS = Math.max(1000, Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS) || 10000);
const ALERT_WEBHOOK_MAX_RETRIES = retryLimit(process.env.ALERT_WEBHOOK_MAX_RETRIES);

const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'reddy59021@gmail.com';
const SENDER_NAME = 'TrendDrop';
// FRONTEND_URL drives all email links. Fall back to CLIENT_URL, then localhost
// so a missing env var never produces 'undefined/verify-email' links.
const BASE_URL = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/+$/, '');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]));

const contactLink = `<a href="mailto:${CONTACT_EMAIL}" style="color:#FF4D6D;">${CONTACT_EMAIL}</a>`;

const hasApiKey = () => {
  // The in-memory E2E harness sets placeholder credentials so production
  // configuration validation can run. Those credentials must never turn into
  // an outbound provider request.
  if (process.env.E2E_IN_MEMORY === '1') {
    return false;
  }
  if (BREVO_API_KEY) return true;
  console.warn('[email] BREVO_API_KEY is not set — skipping outbound email (no network call made).');
  return false;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST one transactional email to Brevo. Throws on transport or API failure;
// callers either await it (operational alerts) or use the fire-and-forget
// wrappers below. Transient failures are retried with bounded backoff, and a
// timeout prevents a stuck provider socket from hanging a cron run forever.
const sendTransactionalEmail = async (payload, { operation = 'transactional' } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= BREVO_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
    try {
      const response = await fetch(BREVO_SMTP_URL, {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`Brevo API error ${response.status}: ${data.message || 'send failed'}`);
        error.response = { body: data };
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      increment('trenddrop_email_delivery_total', { operation, result: 'sent' });
      return data;
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable
        || error?.name === 'AbortError'
        || (error instanceof TypeError && /fetch|network/i.test(error.message));
      if (!retryable || attempt >= BREVO_MAX_RETRIES) break;
      increment('trenddrop_email_retries_total', { operation });
      await sleep(RETRY_BASE_MS * (2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  increment('trenddrop_email_delivery_total', { operation, result: 'failed' });
  throw lastError;
};

// Send email verification. Fire-and-forget: returns immediately so
// registration never blocks on the (slow) email provider; failures are
// logged, never thrown to the caller.
const sendVerificationEmail = (email, name, token) => {
  if (!hasApiKey()) return Promise.resolve({ emailSent: false, skipped: true });
  const verificationUrl = `${BASE_URL}/verify-email?token=${token}`;
  const safeName = escapeHtml(name);
  const safeVerificationUrl = escapeHtml(verificationUrl);

  const sendPromise = (async () => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; margin:0; padding:0; background:#f5f5f5;">
        <div style="max-width:600px; margin:0 auto; padding:20px;">
          <div style="background:linear-gradient(135deg, #FF4D6D, #FF8FA3); padding:30px; text-align:center; border-radius:12px 12px 0 0;">
            <h1 style="color:#fff; margin:0; font-size:24px;">Welcome to TrendDrop! 🎉</h1>
          </div>
          <div style="background:#fff; padding:30px; border-radius:0 0 12px 12px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
            <p style="font-size:16px; color:#333;">Hi <strong>${safeName}</strong>,</p>
            <p style="font-size:16px; color:#555; line-height:1.6;">
              Thanks for signing up! Please verify your email address to start buying and selling on TrendDrop.
            </p>
            <div style="text-align:center; margin:30px 0;">
              <a href="${safeVerificationUrl}"
                 style="background:linear-gradient(135deg, #FF4D6D, #FF8FA3); color:#fff; padding:14px 40px; 
                        text-decoration:none; border-radius:8px; font-size:16px; font-weight:600; display:inline-block;">
                Verify Email Address
              </a>
            </div>
            <p style="font-size:14px; color:#888;">
              Or copy this link: <br>
              <span style="color:#FF4D6D;">${safeVerificationUrl}</span>
            </p>
            <p style="font-size:14px; color:#888; margin-top:20px;">
              This link expires in 24 hours.
            </p>
            <hr style="border:none; border-top:1px solid #eee; margin:20px 0;">
            <p style="font-size:12px; color:#aaa; text-align:center;">
              If you didn't create an account, you can safely ignore this email.
            </p>
            <p style="font-size:12px; color:#aaa; text-align:center;">
              Need help? Contact ${contactLink}.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const data = await sendTransactionalEmail({
      subject: 'Verify your TrendDrop email address',
      htmlContent,
      to: [{ email, name }],
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      replyTo: { email: CONTACT_EMAIL, name: 'TrendDrop Support' },
    });
    console.log('Verification email sent to:', email, 'messageId:', data.messageId);
    return { emailSent: true };
  })();

  sendPromise.catch((error) => {
    console.error('Brevo send error:', error.message, error.response?.body || '');
  });

  return Promise.resolve({ emailSent: true, queued: true });
};


// Send password reset email. Fire-and-forget: returns immediately,
// failures are logged, never thrown to the caller.
const sendPasswordResetEmail = (email, name, token) => {
  if (!hasApiKey()) return Promise.resolve({ emailSent: false, skipped: true });
  const resetUrl = `${BASE_URL}/reset-password?token=${token}`;
  const safeName = escapeHtml(name);
  const safeResetUrl = escapeHtml(resetUrl);

  const sendPromise = (async () => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; background:#f5f5f5; padding:20px;">
        <div style="max-width:600px; margin:0 auto; background:#fff; border-radius:12px; overflow:hidden;">
          <div style="background:linear-gradient(135deg, #FF4D6D, #FF8FA3); padding:30px; text-align:center;">
            <h1 style="color:#fff; margin:0; font-size:20px;">Password Reset</h1>
          </div>
          <div style="padding:30px;">
            <p>Hi <strong>${safeName}</strong>,</p>
            <p>Click the button below to reset your password. This link expires in 1 hour.</p>
            <div style="text-align:center; margin:25px 0;">
              <a href="${safeResetUrl}" style="background:#FF4D6D; color:#fff; padding:12px 35px; text-decoration:none; border-radius:8px; font-size:16px; display:inline-block;">
                Reset Password
              </a>
            </div>
            <p style="font-size:13px; color:#888;">Need help? Contact ${contactLink}.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await sendTransactionalEmail({
      subject: 'Reset your TrendDrop password',
      htmlContent,
      to: [{ email, name }],
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      replyTo: { email: CONTACT_EMAIL, name: 'TrendDrop Support' },
    });
    console.log('Password reset email sent to:', email);
    return { emailSent: true };
  })();

  sendPromise.catch((error) => {
    console.error('Brevo reset error:', error.message);
  });

  return Promise.resolve({ emailSent: true, queued: true });
};

/**
 * Operational alert email for integrity checks. Recipients come from
 * ALERT_EMAILS, then ADMIN_EMAILS, then the configured sender as a last
 * resort. Returns `{ skipped: true }` when email is not configured; throws when
 * the provider rejects the send so the caller can log the failed alert while
 * preserving the audit result.
 */
const operationalAlertRecipients = () => [...new Set(
  String(process.env.ALERT_EMAILS || process.env.ADMIN_EMAILS || SENDER_EMAIL)
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
)];

const getOperationalAlertRecipientKey = () => crypto
  .createHash('sha256')
  .update(operationalAlertRecipients().join('\n'))
  .digest('hex')
  .slice(0, 16);

// Secondary paging transport. A webhook keeps alerting alive when Brevo is
// down or email is not configured. The payload is intentionally compatible
// with Slack incoming webhooks and generic automation endpoints.
const sendAlertWebhook = async ({ subject, text }) => {
  if (!ALERT_WEBHOOK_URL) return { sent: false, skipped: true };
  let lastError;
  for (let attempt = 0; attempt <= ALERT_WEBHOOK_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ALERT_WEBHOOK_TIMEOUT_MS);
    try {
      const response = await fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'trenddrop',
          subject,
          text: `${subject}\n\n${text}`,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`Alert webhook error ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      increment('trenddrop_operational_alert_delivery_total', { result: 'webhook_sent' });
      return { sent: true };
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable
        || error?.name === 'AbortError'
        || (error instanceof TypeError && /fetch|network/i.test(error.message));
      if (!retryable || attempt >= ALERT_WEBHOOK_MAX_RETRIES) break;
      increment('trenddrop_email_retries_total', { operation: 'alert_webhook' });
      await sleep(RETRY_BASE_MS * (2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  increment('trenddrop_operational_alert_delivery_total', { result: 'webhook_failed' });
  console.error('[email] Alert webhook delivery failed:', lastError?.message || 'unknown error');
  return { sent: false, error: lastError };
};

const sendOperationalAlert = async ({ subject, text }) => {
  const safeSubject = String(subject || 'TrendDrop operational alert').slice(0, 180);
  const recipients = operationalAlertRecipients();
  const emailConfigured = hasApiKey() && recipients.length > 0;

  if (!emailConfigured) {
    const webhook = await sendAlertWebhook({ subject: safeSubject, text: text || safeSubject });
    if (webhook.sent) {
      console.log('[email] Operational alert delivered through webhook fallback:', safeSubject);
      return { emailSent: false, webhookSent: true };
    }
    increment('trenddrop_operational_alert_delivery_total', { result: 'skipped' });
    console.warn('[email] No operational alert delivery path configured; skipping alert.');
    return { emailSent: false, skipped: true };
  }

  const safeText = escapeHtml(text || safeSubject);
  try {
    const data = await sendTransactionalEmail({
      subject: safeSubject,
      textContent: text || safeSubject,
      htmlContent: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#222;"><h2>${escapeHtml(safeSubject)}</h2><pre style="white-space:pre-wrap;font-family:inherit;">${safeText}</pre></div>`,
      to: recipients.map((email) => ({ email })),
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      replyTo: { email: CONTACT_EMAIL, name: 'TrendDrop Operations' },
    }, { operation: 'operational_alert' });
    increment('trenddrop_operational_alert_delivery_total', { result: 'sent' });
    console.log('[email] Operational alert sent:', safeSubject);
    return { emailSent: true, messageId: data.messageId };
  } catch (error) {
    increment('trenddrop_operational_alert_delivery_total', { result: 'failed' });
    const webhook = await sendAlertWebhook({ subject: safeSubject, text: text || safeSubject });
    if (webhook.sent) {
      console.log('[email] Operational alert delivered through webhook fallback:', safeSubject);
      return { emailSent: false, webhookSent: true, emailError: error.message };
    }
    error.webhookError = webhook.error?.message || 'not configured';
    throw error;
  }
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendOperationalAlert,
  getOperationalAlertRecipientKey,
};
