const express = require('express');
const router = express.Router();
const { carriers, countryCarriers, calculateShipping, generateLabel, getTrackingStatuses } = require('../config/shipping');
const { currencies } = require('../config/currencies');
const { auth } = require('../middleware/auth');

// GET /api/shipping/rates - Calculate shipping rates
router.post('/rates', async (req, res) => {
  try {
    const { fromCountry, toCountry, weightKg, itemPrice } = req.body;
    if (!fromCountry || !toCountry) {
      return res.status(400).json({ message: 'fromCountry and toCountry are required' });
    }
    const rate = calculateShipping(fromCountry, toCountry, weightKg || 0.5, itemPrice || 0);
    const availableCarriers = countryCarriers[toCountry] || countryCarriers.default;
    const carrierDetails = availableCarriers.map(code => ({
      code,
      name: carriers[code]?.name || code,
      ...calculateShipping(fromCountry, toCountry, weightKg || 0.5, itemPrice || 0),
    }));
    res.json({ rate, carriers: carrierDetails });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/shipping/carriers - Get available carriers for a country
router.get('/carriers/:country', (req, res) => {
  const codes = countryCarriers[req.params.country] || countryCarriers.default;
  const result = codes.map(code => ({
    code,
    name: carriers[code]?.name || code,
    trackingUrl: carriers[code]?.trackingUrl || '',
  }));
  res.json(result);
});

// GET /api/shipping/countries - Get all supported countries
router.get('/countries', (req, res) => {
  const countries = Object.keys(countryCarriers).filter(k => k !== 'default').map(code => ({
    code,
    carriers: countryCarriers[code].map(c => carriers[c]?.name || c),
  }));
  res.json(countries);
});

// POST /api/shipping/label - Generate shipping label
router.post('/label', auth, async (req, res) => {
  try {
    const { orderId, carrier, shippingAddress, sellerAddress } = req.body;
    if (!carrier || !shippingAddress) {
      return res.status(400).json({ message: 'carrier and shippingAddress are required' });
    }
    const label = generateLabel({ shippingAddress, sellerAddress }, carrier);
    res.json({ message: 'Label generated', label });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/shipping/tracking/:trackingNumber - Get tracking info
router.get('/tracking/:trackingNumber', async (req, res) => {
  try {
    const statuses = getTrackingStatuses();
    // Simulate tracking - in production, poll carrier APIs
    const trackingNumber = req.params.trackingNumber;
    const currentStatus = statuses[0]; // label_created as default
    res.json({
      trackingNumber,
      status: currentStatus,
      history: [{ ...currentStatus, timestamp: new Date().toISOString(), location: 'Origin Facility' }],
      estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/shipping/currencies - Get all supported currencies
router.get('/currencies', (req, res) => {
  const list = Object.entries(currencies).map(([code, info]) => ({ code, ...info }));
  res.json(list);
});

module.exports = router;