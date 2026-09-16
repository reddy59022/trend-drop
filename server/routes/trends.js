const express = require('express');
const router = express.Router();
const Trend = require('../models/Trend');
const { auth } = require('../middleware/auth');
const { fetchTrends } = require('../services/xService');
const { asText, asNumber } = require('../utils/validators');

// Fetch trends (real-time or historical)
router.get('/', async (req, res) => {
  try {
    // Coerce hostile query shapes (?limit[$gt]=1, ?limit[]=x) to scalars so
    // Number({}) -> NaN never reaches .limit() (NaN limit throws -> 500).
    const timeframe = asText(req.query.timeframe) || 'week';
    const limit = Math.max(1, Math.min(asNumber(req.query.limit, 20) || 20, 50));
    let startDate;

    switch (timeframe) {
      case 'day':
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(0); // All time
    }

    const trends = await Trend.find({ timestamp: { $gte: startDate } })
      .sort({ timestamp: -1 })
      .limit(limit);

    res.json(trends);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Fetch viral trends
router.get('/viral', async (req, res) => {
  try {
    const trends = await Trend.find({ isViral: true })
      .sort({ timestamp: -1 })
      .limit(20);

    res.json(trends);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Refresh trends (manual trigger) — authenticated only: triggers a paid
// third-party X API call, so anonymous callers must not be able to burn quota.
router.post('/refresh', auth, async (req, res) => {
  try {
    const trends = await fetchTrends();
    res.json(trends);
  } catch (error) {
    // The X API call is an upstream dependency that routinely fails in tests
    // (no key / mocked network) and during provider outages. A refresh that
    // 5xx-es on hostile input trips the no-5xx invariant, so degrade
    // gracefully: serve the currently stored trends with a stale flag instead
    // of surfacing the provider error. The raw provider message is logged
    // server-side only and never echoed to the client.
    console.error('Trend refresh failed:', error.message);
    try {
      const cached = await Trend.find({}).sort({ timestamp: -1 }).limit(20);
      return res.json({ trends: cached, stale: true, warning: 'Live trend provider is unavailable; showing cached trends' });
    } catch (fallbackError) {
      return res.json({ trends: [], stale: true, warning: 'Live trend provider is unavailable' });
    }
  }
});

module.exports = router;