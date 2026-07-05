const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const CrossBorder = require('../models/CrossBorder');

// GET /api/cross-border - Get user's cross-border settings
router.get('/', auth, async (req, res) => {
  try {
    let settings = await CrossBorder.findOne({ seller: req.user._id, isActive: true });
    
    if (!settings) {
      settings = await CrossBorder.create({
        seller: req.user._id,
        country: req.user.country || 'US',
        currency: req.user.currency || 'USD',
      });
    }
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch cross-border settings' });
  }
});

// PUT /api/cross-border - Update cross-border settings
router.put('/', auth, async (req, res) => {
  try {
    const { country, currency, taxId, shippingPartners } = req.body;
    
    let settings = await CrossBorder.findOne({ seller: req.user._id, isActive: true });
    
    if (!settings) {
      settings = await CrossBorder.create({
        seller: req.user._id,
        country: country || req.user.country || 'US',
        currency: currency || req.user.currency || 'USD',
        taxId,
        shippingPartners,
      });
    } else {
      if (country) settings.country = country;
      if (currency) settings.currency = currency;
      if (taxId) settings.taxId = taxId;
      if (shippingPartners) settings.shippingPartners = shippingPartners;
      await settings.save();
    }
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update cross-border settings' });
  }
});

// GET /api/cross-border/countries - Get supported countries
router.get('/countries', async (req, res) => {
  try {
    res.json([
      { code: 'US', name: 'United States', currency: 'USD' },
      { code: 'CA', name: 'Canada', currency: 'CAD' },
      { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
      { code: 'EU', name: 'Europe', currency: 'EUR' },
      { code: 'AU', name: 'Australia', currency: 'AUD' },
      { code: 'JP', name: 'Japan', currency: 'JPY' },
    ]);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch countries' });
  }
});

module.exports = router;