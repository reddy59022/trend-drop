const express = require('express');
const router = express.Router();
const { boostConfig } = require('../config/boost');

/**
 * GET /api/boost/config
 * Returns the boost configuration – tiers, limits and pricing rules.
 * This endpoint is useful for client applications to display boost options
 * without hard‑coding values.
 */
router.get('/config', (req, res) => {
  try {
    res.json({
      boostFeePercent: boostConfig.boostFeePercent,
      minDurationDays: boostConfig.minDurationDays,
      maxDurationDays: boostConfig.maxDurationDays,
      defaultDurationDays: boostConfig.defaultDurationDays,
      priorityMultiplier: boostConfig.priorityMultiplier,
      maxActiveBoosts: boostConfig.maxActiveBoosts,
      tiers: boostConfig.tiers,
    });
  } catch (error) {
    console.error('Boost config error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;