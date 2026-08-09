const express = require('express');
const router = express.Router();
const Trend = require('../models/Trend');
const { fetchTrends } = require('../services/xService');

// Fetch trends (real-time or historical)
router.get('/', async (req, res) => {
  try {
    const { timeframe = 'week', limit = 20 } = req.query;
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
      .limit(Number(limit));

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

// Refresh trends (manual trigger)
router.post('/refresh', async (req, res) => {
  try {
    const trends = await fetchTrends();
    res.json(trends);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;