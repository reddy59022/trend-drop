const express = require('express');
const router = express.Router();
const {
  getSupportedCountries,
  isCountrySupported,
  BLOCKED_REGION_MESSAGE,
} = require('../config/marketplace');

// GET /api/marketplace/countries - Supported markets (USA + Europe)
router.get('/countries', (req, res) => {
  try {
    res.json(getSupportedCountries());
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/marketplace/status?country=XX - Region availability check.
// Always 200 so clients can render the appropriate screen themselves.
router.get('/status', (req, res) => {
  try {
    const country = String(req.query.country || 'US').toUpperCase();
    const supported = isCountrySupported(country);
    res.json({
      country,
      supported,
      message: supported ? 'Available in your area' : BLOCKED_REGION_MESSAGE,
      code: supported ? 'REGION_SUPPORTED' : 'REGION_NOT_SUPPORTED',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;