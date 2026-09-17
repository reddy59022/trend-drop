const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const EnterpriseWebhook = require('../models/EnterpriseWebhook');
const { EVENT_TYPES } = require('../models/EnterpriseWebhook');

const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  message: { message: 'Rate limit exceeded' },
});

const parsePage = (value, fallback = 1) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseLimit = (value, fallback = 100) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback;
};

const parseDate = (value) => {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const dateFilter = (startDate, endDate) => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start === undefined || end === undefined || (start && end && start > end)) return null;
  if (!start && !end) return {};
  return { createdAt: { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) } };
};

// GET /api/enterprise/listings - Bulk list the authenticated user's listings.
router.get('/listings', auth, apiLimiter, async (req, res) => {
  try {
    const page = parsePage(req.query.page);
    const limit = parseLimit(req.query.limit);
    const filter = { seller: req.user._id };
    const dates = dateFilter(req.query.startDate, req.query.endDate);
    if (dates === null) return res.status(400).json({ message: 'Invalid date range' });
    Object.assign(filter, dates);

    const [listings, total] = await Promise.all([
      Listing.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Listing.countDocuments(filter),
    ]);
    res.set('X-Total-Count', String(total));
    res.set('X-Page', String(page));
    res.set('X-Page-Limit', String(limit));
    res.json(listings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch listings' });
  }
});

// GET /api/enterprise/orders - Orders involving the authenticated user.
router.get('/orders', auth, apiLimiter, async (req, res) => {
  try {
    const page = parsePage(req.query.page);
    const limit = parseLimit(req.query.limit);
    const role = req.query.role === 'buyer' ? 'buyer' : req.query.role === 'seller' ? 'seller' : 'any';
    const ownership = role === 'buyer' ? { buyer: req.user._id } : role === 'seller' ? { seller: req.user._id } : {
      $or: [{ buyer: req.user._id }, { seller: req.user._id }],
    };
    const dates = dateFilter(req.query.startDate, req.query.endDate);
    if (dates === null) return res.status(400).json({ message: 'Invalid date range' });
    const filter = { ...ownership, ...dates };

    const [transactions, total] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Transaction.countDocuments(filter),
    ]);
    res.set('X-Total-Count', String(total));
    res.set('X-Page', String(page));
    res.set('X-Page-Limit', String(limit));
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// POST /api/enterprise/webhook - Register or replace the user's webhook.
router.post('/webhook', auth, async (req, res) => {
  try {
    const { url, events } = req.body || {};
    if (typeof url !== 'string') return res.status(400).json({ message: 'A webhook URL is required' });
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch (_) { return res.status(400).json({ message: 'Webhook URL is invalid' }); }
    if (parsedUrl.protocol !== 'https:') {
      return res.status(400).json({ message: 'Webhook URL must use HTTPS' });
    }
    if (!Array.isArray(events) || events.length === 0 || events.some((event) => !EVENT_TYPES.includes(event))) {
      return res.status(400).json({ message: 'Webhook events are invalid' });
    }

    const webhook = await EnterpriseWebhook.findOneAndUpdate(
      { user: req.user._id },
      { user: req.user._id, url: parsedUrl.toString(), events: [...new Set(events)], active: true },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    // Keep the original 200 response contract for existing enterprise clients.
    res.status(200).json({ ...webhook, status: 'registered' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to register webhook' });
  }
});

// POST /api/enterprise/export - Return a bounded, scoped data export.
router.post('/export', auth, async (req, res) => {
  try {
    const { type, startDate, endDate } = req.body || {};
    // `transactions` is the legacy public name retained for existing clients;
    // it maps to the same transaction-backed order export as `orders`.
    if (!['listings', 'orders', 'transactions'].includes(type)) {
      return res.status(400).json({ message: 'Export type must be listings, orders, or transactions' });
    }
    const dates = dateFilter(startDate, endDate);
    if (dates === null) return res.status(400).json({ message: 'Invalid date range' });

    const ownership = type === 'listings'
      ? { seller: req.user._id }
      : { $or: [{ buyer: req.user._id }, { seller: req.user._id }] };
    const records = type === 'listings'
      ? await Listing.find({ ...ownership, ...dates }).sort({ createdAt: 1, _id: 1 }).limit(10000).lean()
      : await Transaction.find({ ...ownership, ...dates }).sort({ createdAt: 1, _id: 1 }).limit(10000).lean();

    res.json({ type, generatedAt: new Date(), recordCount: records.length, records });
  } catch (error) {
    res.status(500).json({ message: 'Failed to export data' });
  }
});

module.exports = router;
