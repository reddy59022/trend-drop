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

    // Hostile-input guards. `shippingPartners` is a subdocument array, so a
    // non-array (e.g. a string) makes Mongoose throw a CastError -> 500; the
    // scalar fields would be silently coerced instead of rejected.
    if (country !== undefined && (typeof country !== 'string' || !country.trim())) {
      return res.status(400).json({ message: 'country must be a non-empty string' });
    }
    if (currency !== undefined && (typeof currency !== 'string' || !currency.trim())) {
      return res.status(400).json({ message: 'currency must be a non-empty string' });
    }
    if (taxId !== undefined && taxId !== null && typeof taxId !== 'string') {
      return res.status(400).json({ message: 'taxId must be a string' });
    }
    if (shippingPartners !== undefined) {
      if (!Array.isArray(shippingPartners)) {
        return res.status(400).json({ message: 'shippingPartners must be an array' });
      }
      for (const partner of shippingPartners) {
        if (!partner || typeof partner !== 'object' || Array.isArray(partner)) {
          return res.status(400).json({ message: 'Each shipping partner must be an object' });
        }
        if (partner.name !== undefined && partner.name !== null && typeof partner.name !== 'string') {
          return res.status(400).json({ message: 'shippingPartners[].name must be a string' });
        }
        if (partner.enabled !== undefined && typeof partner.enabled !== 'boolean') {
          return res.status(400).json({ message: 'shippingPartners[].enabled must be a boolean' });
        }
        if (partner.rateMultiplier !== undefined
            && (typeof partner.rateMultiplier !== 'number' || !Number.isFinite(partner.rateMultiplier))) {
          return res.status(400).json({ message: 'shippingPartners[].rateMultiplier must be a number' });
        }
      }
    }
    
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