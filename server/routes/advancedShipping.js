const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const ShippingIntegration = require('../models/ShippingIntegration');

// GET /api/advanced-shipping - Get shipping integrations
router.get('/', auth, async (req, res) => {
  try {
    const integrations = await ShippingIntegration.find({ user: req.user._id });
    res.json(integrations);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch shipping integrations' });
  }
});

// POST /api/advanced-shipping - Add carrier integration
router.post('/', auth, async (req, res) => {
  try {
    const { carrier, apiKey, accountNumber } = req.body;

    // Hostile-input guard: carrier (required + enum) and apiKey (required) are
    // String paths — a missing or wrong-typed value was a ValidationError -> 500.
    const CARRIERS = ['UPS', 'FedEx', 'DHL', 'USPS'];
    if (!CARRIERS.includes(carrier)) {
      return res.status(400).json({ message: `carrier must be one of ${CARRIERS.join(', ')}` });
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ message: 'apiKey is required' });
    }
    if (accountNumber !== undefined && accountNumber !== null && typeof accountNumber !== 'string') {
      return res.status(400).json({ message: 'accountNumber must be a string' });
    }

    const integration = await ShippingIntegration.create({
      user: req.user._id,
      carrier,
      apiKey,
      accountNumber
    });

    res.status(201).json(integration);
  } catch (error) {
    res.status(500).json({ message: 'Failed to add shipping integration' });
  }
});

// POST /api/advanced-shipping/rates - Calculate real-time shipping rate
router.post('/rates', auth, async (req, res) => {
  try {
    const { carrier, weight, dimensions, fromZip, toZip } = req.body;
    
    const integration = await ShippingIntegration.findOne({ user: req.user._id, carrier });
    if (!integration) {
      return res.status(404).json({ message: 'Carrier integration not found' });
    }

    // Simulated rate calculation
    const rate = {
      carrier,
      estimatedCost: 5 + (weight * 0.5),
      estimatedDays: 3,
      service: 'Ground'
    };

    res.json(rate);
  } catch (error) {
    res.status(500).json({ message: 'Failed to calculate rate' });
  }
});

// POST /api/advanced-shipping/label - Generate shipping label
router.post('/label', auth, async (req, res) => {
  try {
    const { carrier, service, toAddress, weight } = req.body;

    // Simulated label generation
    const label = {
      trackingNumber: '1Z' + Math.random().toString(36).substr(2, 16).toUpperCase(),
      labelUrl: 'https://example.com/label.pdf',
      cost: 8.50
    };

    res.json(label);
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate label' });
  }
});

// GET /api/advanced-shipping/tracking/:trackingNumber - Track shipment
router.get('/tracking/:trackingNumber', auth, async (req, res) => {
  try {
    // Simulated tracking info
    const tracking = {
      trackingNumber: req.params.trackingNumber,
      status: 'In Transit',
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      events: [
        { date: new Date(), location: 'Distribution Center', status: 'Package received' }
      ]
    };

    res.json(tracking);
  } catch (error) {
    res.status(500).json({ message: 'Failed to track shipment' });
  }
});

module.exports = router;