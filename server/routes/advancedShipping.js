const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const ShippingIntegration = require('../models/ShippingIntegration');

// Canonical carrier set — mirrors the ShippingIntegration model enum.
const CARRIERS = ['UPS', 'FedEx', 'DHL', 'USPS'];
/**
 * Accept case-insensitive carrier names ('fedex', 'usps', 'dhl') and map them
 * to the canonical enum value stored in the model and used by /rates lookups.
 * Returns undefined for unknown/non-string values so callers can 400.
 */
const normalizeCarrier = (value) => {
  if (typeof value !== 'string') return undefined;
  const needle = value.trim().toLowerCase();
  return CARRIERS.find((c) => c.toLowerCase() === needle);
};

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
    const { apiKey, accountNumber } = req.body;

    // Hostile-input guard: carrier (required + enum) and apiKey (required) are
    // String paths — a missing or wrong-typed value was a ValidationError -> 500.
    // Carrier names are normalized case-insensitively ('fedex' -> 'FedEx') so
    // clients that don't match the canonical casing still work.
    const carrier = normalizeCarrier(req.body.carrier);
    if (!carrier) {
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
    // Normalize the carrier the same way POST / does, so an integration saved
    // as 'FedEx' is found when the client asks for 'fedex'.
    const carrier = normalizeCarrier(req.body.carrier);
    const { dimensions, fromZip, toZip } = req.body;
    // Numeric-safe weight: a hostile value ('abc', {}, arrays) must not turn
    // the simulated cost into NaN.
    const weight = Number(req.body.weight);
    const safeWeight = Number.isFinite(weight) && weight >= 0 ? weight : 0;

    // An unknown carrier must not fall through to findOne({ carrier: undefined }),
    // which would match ANY of the user's integrations.
    if (!carrier) {
      return res.status(400).json({ message: `carrier must be one of ${CARRIERS.join(', ')}` });
    }

    const integration = await ShippingIntegration.findOne({ user: req.user._id, carrier });
    if (!integration) {
      return res.status(404).json({ message: 'Carrier integration not found' });
    }

    // Simulated rate calculation
    const rate = {
      carrier,
      estimatedCost: 5 + (safeWeight * 0.5),
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
    // Hostile-input contract (TDD R27): this handler used to ignore every
    // field and always answer 200 with a tracking number — so a missing
    // service, an object where an address belongs, or a 1,000,000,000 kg
    // parcel all produced a "successful" label. That is worse than a 500 for
    // the caller: nothing tells them the shipment was never described. Every
    // field needed to describe a parcel is now validated, and only then does
    // the label get issued.
    const carrier = normalizeCarrier(req.body.carrier);
    if (!carrier) {
      return res.status(400).json({ message: `carrier must be one of ${CARRIERS.join(', ')}` });
    }

    const { service, toAddress } = req.body;
    if (typeof service !== 'string' || !service.trim()) {
      return res.status(400).json({ message: 'service is required' });
    }

    // The E2E flow sends a one-line address string, so both shapes are valid;
    // an empty string/object/array is not an address.
    const addressOk = (typeof toAddress === 'string' && toAddress.trim())
      || (toAddress !== null && typeof toAddress === 'object' && !Array.isArray(toAddress)
        && ['street1', 'street', 'address', 'city', 'postalCode']
          .some((k) => typeof toAddress[k] === 'string' && toAddress[k].trim()));
    if (!addressOk) {
      return res.status(400).json({ message: 'toAddress is required' });
    }

    const MAX_LABEL_WEIGHT_KG = 500;
    const weight = typeof req.body.weight === 'number'
      ? req.body.weight
      : (typeof req.body.weight === 'string' && req.body.weight.trim() !== ''
        ? Number(req.body.weight)
        : NaN);
    if (!Number.isFinite(weight) || weight <= 0 || weight > MAX_LABEL_WEIGHT_KG) {
      return res.status(400).json({ message: `weight must be a number greater than 0 and at most ${MAX_LABEL_WEIGHT_KG}` });
    }

    // Simulated label generation
    const label = {
      trackingNumber: '1Z' + Math.random().toString(36).substr(2, 16).toUpperCase(),
      labelUrl: 'https://example.com/label.pdf',
      cost: 8.50,
      // Echo the validated parcel description so the caller can confirm what
      // was actually labelled. Explicit mock metadata prevents clients from
      // presenting this local fallback as purchased carrier postage.
      carrier,
      service: service.trim(),
      weight,
      mock: true,
      postagePurchased: false,
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