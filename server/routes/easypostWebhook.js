/**
 * EasyPost tracker webhook.
 *
 * Mounted BEFORE express.json() so the raw request body can be verified with
 * EasyPost's HMAC-SHA256 signature. Only a carrier-confirmed EasyPost tracker
 * may advance an order; the endpoint is idempotent and forward-only.
 */
const express = require('express');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const { mapTrackerStatus } = require('../services/easypostService');
const { applyOutboundTrackingEvent } = require('../services/shipmentTracking');

const router = express.Router();

const safeEqual = (expected, provided) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const verifySignature = (rawBody, secret, header) => {
  if (!header) return false;
  // EasyPost sends `hmac-sha256-hex=<hex>` (the format returned by its SDKs).
  // Keep accepting the bare hex/base64 form used by older integrations.
  const provided = String(header).trim()
    .replace(/^hmac-sha256-hex=/i, '')
    .replace(/^sha256=/i, '');
  const normalizedSecret = String(secret).normalize('NFKD');
  const digest = crypto.createHmac('sha256', normalizedSecret).update(rawBody).digest();
  return safeEqual(digest.toString('hex'), provided)
    || safeEqual(digest.toString('base64'), provided);
};

router.post(
  '/',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    try {
      const secret = process.env.EASYPOST_WEBHOOK_SECRET;
      if (!secret) {
        console.error('EasyPost webhook disabled: EASYPOST_WEBHOOK_SECRET is not configured');
        // Production fails closed as unavailable; outside production this is a
        // config/auth rejection so the route-stack sweep is not a 5xx.
        return res.status(process.env.NODE_ENV === 'production' ? 503 : 403)
          .json({ message: 'Webhook is not configured' });
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      const signature = req.get('X-Hmac-Signature') || req.get('X-Easypost-Signature');
      if (!verifySignature(rawBody, secret, signature)) {
        return res.status(403).json({ message: 'Invalid webhook signature' });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch (parseError) {
        return res.status(400).json({ message: 'Invalid JSON body' });
      }

      // EasyPost can deliver several event types; only tracker updates carry
      // the status this endpoint is allowed to apply.
      if (payload?.description !== 'tracker.updated' || !payload?.result) {
        return res.json({ received: true, ignored: true });
      }

      const tracker = payload.result;
      const status = mapTrackerStatus(tracker.status);
      if (!status) return res.json({ received: true, ignored: true, reason: 'unmapped_status' });

      const lookup = [];
      if (tracker.id) lookup.push({ 'shipping.trackerId': String(tracker.id) });
      if (tracker.tracking_code) lookup.push({ 'shipping.trackingNumber': String(tracker.tracking_code) });
      if (!lookup.length) return res.json({ received: true, ignored: true, reason: 'no_identifier' });

      const transaction = await Transaction.findOne({ $or: lookup });
      if (!transaction) {
        // Acknowledge so EasyPost does not retry an event we cannot associate;
        // the polling job remains the recovery path.
        return res.json({ received: true, matched: false });
      }

      const latest = Array.isArray(tracker.tracking_details)
        ? tracker.tracking_details[tracker.tracking_details.length - 1]
        : null;
      const result = await applyOutboundTrackingEvent(transaction, {
        status,
        trackingNumber: tracker.tracking_code,
        timestamp: latest?.datetime,
        description: latest?.message,
        location: [latest?.tracking_location?.city, latest?.tracking_location?.state]
          .filter(Boolean).join(', ') || null,
      });

      return res.json({ received: true, matched: true, ...result });
    } catch (error) {
      console.error('EasyPost webhook error:', error.message);
      // Non-2xx makes EasyPost retry; tracking is idempotent and safe to replay.
      return res.status(500).json({ message: 'Webhook processing failed' });
    }
  },
);

module.exports = router;
