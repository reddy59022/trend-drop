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
const { trackingStatuses } = require('../config/shipping');
const { mapTrackerStatus } = require('../services/easypostService');

const router = express.Router();

const safeEqual = (expected, provided) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const verifySignature = (rawBody, secret, header) => {
  if (!header) return false;
  const provided = String(header).trim().replace(/^sha256=/i, '');
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest();
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

      const newIndex = trackingStatuses.findIndex((s) => s.code === status);
      const currentIndex = trackingStatuses.findIndex((s) => s.code === transaction.status);
      const terminal = ['exception', 'returned'].includes(status);
      // `exception` is recorded in history but is not a lifecycle enum value.
      const advances = status !== 'exception' && status !== transaction.status && (
        terminal
          ? transaction.status !== 'delivered'
          : (currentIndex === -1 || newIndex > currentIndex)
      );

      if (advances || status === 'exception') {
        if (advances) transaction.status = status === 'in_transit_local' ? 'in_transit' : status;
        const latest = Array.isArray(tracker.tracking_details)
          ? tracker.tracking_details[tracker.tracking_details.length - 1]
          : null;
        if (latest) {
          transaction.shipping = transaction.shipping || {};
          transaction.shipping.trackingHistory = transaction.shipping.trackingHistory || [];
          const eventTime = latest.datetime ? new Date(latest.datetime) : new Date();
          const duplicate = transaction.shipping.trackingHistory.some((entry) => (
            entry.status === status
            && new Date(entry.timestamp).getTime() === eventTime.getTime()
          ));
          if (!duplicate) {
            transaction.shipping.trackingHistory.push({
              status,
              label: trackingStatuses.find((s) => s.code === status)?.label || status,
              description: latest.message || '',
              timestamp: eventTime,
              location: [latest.tracking_location?.city, latest.tracking_location?.state]
                .filter(Boolean).join(', ') || null,
            });
            transaction.shipping.trackingHistory = transaction.shipping.trackingHistory.slice(-50);
          }
          if (status === 'delivered') transaction.shipping.actualDelivery = eventTime;
        } else if (status === 'delivered') {
          transaction.shipping = transaction.shipping || {};
          transaction.shipping.actualDelivery = new Date();
        }
        await transaction.save();
      }

      return res.json({
        received: true,
        matched: true,
        status,
        advanced: advances,
        transactionId: String(transaction._id),
      });
    } catch (error) {
      console.error('EasyPost webhook error:', error.message);
      // Non-2xx makes EasyPost retry; tracking is idempotent and safe to replay.
      return res.status(500).json({ message: 'Webhook processing failed' });
    }
  },
);

module.exports = router;
