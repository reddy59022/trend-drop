const express = require('express');
const router = express.Router();
const Promo = require('../models/Promo');
const Listing = require('../models/Listing');
const { auth } = require('../middleware/auth');
const adminAuth = require('../middleware/admin');

// POST /api/promos - Create promo code
router.post('/', auth, async (req, res) => {
  try {
    const { code, discountType, discountValue, minPurchaseAmount, maxDiscountAmount, expiresAt, usageLimit, applicableCategories, description } = req.body;

    if (!code || !discountType || !discountValue) {
      return res.status(400).json({ message: 'Code, discountType, and discountValue are required' });
    }

    if (!['percentage', 'fixed'].includes(discountType)) {
      return res.status(400).json({ message: 'discountType must be "percentage" or "fixed"' });
    }

    // discountValue sanity: a negative/zero discount would INCREASE what the
    // buyer pays, and a percentage above 100 would exceed the order total.
    if (typeof discountValue !== 'number' || !Number.isFinite(discountValue) || discountValue <= 0) {
      return res.status(400).json({ message: 'discountValue must be a positive number' });
    }
    if (discountType === 'percentage' && discountValue > 100) {
      return res.status(400).json({ message: 'percentage discount cannot exceed 100' });
    }

    // Money/limit fields must be non-negative: negative minPurchase makes
    // every cart eligible, negative maxDiscount corrupts caps, negative
    // usageLimit breaks limit math (0 = unlimited is the only sentinel).
    for (const [field, value] of [['minPurchaseAmount', minPurchaseAmount], ['maxDiscountAmount', maxDiscountAmount], ['usageLimit', usageLimit]]) {
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        return res.status(400).json({ message: `${field} must be a non-negative number` });
      }
    }

    // Check for duplicate code for this seller
    const existing = await Promo.findOne({ code: code.toUpperCase(), seller: req.user._id });
    if (existing) {
      return res.status(400).json({ message: 'A promo code with this name already exists' });
    }

    const promo = await Promo.create({
      code: code.toUpperCase(),
      seller: req.user._id,
      discountType,
      discountValue,
      minPurchaseAmount: minPurchaseAmount || 0,
      maxDiscountAmount: maxDiscountAmount || 0,
      expiresAt: expiresAt || null,
      usageLimit: usageLimit || 0,
      applicableCategories: applicableCategories || [],
      description: description || '',
    });

    res.status(201).json(promo);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/promos - List seller's promo codes
router.get('/', auth, async (req, res) => {
  try {
    const promos = await Promo.find({ seller: req.user._id }).sort({ createdAt: -1 });
    res.json(promos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/promos/:id - Update promo code
router.put('/:id', auth, async (req, res) => {
  try {
    const promo = await Promo.findById(req.params.id);
    if (!promo) return res.status(404).json({ message: 'Promo code not found' });
    if (promo.seller.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });

    const { discountType, discountValue, minPurchaseAmount, maxDiscountAmount, expiresAt, usageLimit, isActive, applicableCategories, description } = req.body;
    // Validate discount fields up-front (same rules as creation): without
    // this, invalid values fell through to save() -> ValidationError -> 500
    // (or worse, silently persisted). Must be 400, never 500.
    if (discountType !== undefined && !['percentage', 'fixed'].includes(discountType)) {
      return res.status(400).json({ message: 'discountType must be "percentage" or "fixed"' });
    }
    if (discountValue !== undefined) {
      if (typeof discountValue !== 'number' || !Number.isFinite(discountValue) || discountValue <= 0) {
        return res.status(400).json({ message: 'discountValue must be a positive number' });
      }
      const effectiveType = discountType || promo.discountType;
      if (effectiveType === 'percentage' && discountValue > 100) {
        return res.status(400).json({ message: 'percentage discount cannot exceed 100' });
      }
    }
    if (discountType) promo.discountType = discountType;
    if (discountValue !== undefined) promo.discountValue = discountValue;
    if (minPurchaseAmount !== undefined) {
      if (typeof minPurchaseAmount !== 'number' || !Number.isFinite(minPurchaseAmount) || minPurchaseAmount < 0) {
        return res.status(400).json({ message: 'minPurchaseAmount must be a non-negative number' });
      }
      promo.minPurchaseAmount = minPurchaseAmount;
    }
    if (maxDiscountAmount !== undefined) {
      if (typeof maxDiscountAmount !== 'number' || !Number.isFinite(maxDiscountAmount) || maxDiscountAmount < 0) {
        return res.status(400).json({ message: 'maxDiscountAmount must be a non-negative number' });
      }
      promo.maxDiscountAmount = maxDiscountAmount;
    }
    if (expiresAt !== undefined) promo.expiresAt = expiresAt;
    if (usageLimit !== undefined) {
      if (typeof usageLimit !== 'number' || !Number.isFinite(usageLimit) || usageLimit < 0) {
        return res.status(400).json({ message: 'usageLimit must be a non-negative number' });
      }
      promo.usageLimit = usageLimit;
    }
    if (isActive !== undefined) promo.isActive = isActive;
    if (applicableCategories) promo.applicableCategories = applicableCategories;
    if (description !== undefined) promo.description = description;

    await promo.save();
    res.json(promo);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/promos/:id - Delete promo code
router.delete('/:id', auth, async (req, res) => {
  try {
    const promo = await Promo.findById(req.params.id);
    if (!promo) return res.status(404).json({ message: 'Promo code not found' });
    if (promo.seller.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });

    await Promo.deleteOne({ _id: req.params.id });
    res.json({ message: 'Promo code deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/promos/validate - Validate promo code at checkout
router.post('/validate', auth, async (req, res) => {
  try {
    const { code, items } = req.body; // items: array of { listingId, price, quantity, category }
    if (!code) return res.status(400).json({ message: 'Promo code is required' });

    const promo = await Promo.findOne({ code: code.toUpperCase(), isActive: true });
    if (!promo) return res.status(400).json({ message: 'Invalid promo code' });

    // Check expiration
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Promo code has expired' });
    }

    // Check usage limit
    if (promo.usageLimit > 0 && promo.usageCount >= promo.usageLimit) {
      return res.status(400).json({ message: 'Promo code usage limit reached' });
    }

    // Calculate total — restricted to items that belong to the promo's own
    // seller. Promo documents are seller-scoped (creation enforces per-seller
    // uniqueness), so honouring a code against ANOTHER seller's items (or
    // counting their items toward minPurchase) is wrong. If none of the cart
    // items belong to the promo's seller, the code does not apply.
    let total = 0;
    let eligibleTotal = 0;
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const listing = await Listing.findById(item.listingId);
        // Seller scoping: only the promo owner's items are eligible.
        if (listing && String(listing.seller) !== String(promo.seller)) continue;
        // Category restriction (unchanged).
        if (listing && promo.applicableCategories && promo.applicableCategories.length > 0
            && !promo.applicableCategories.includes(listing.category)) continue;
        const lineTotal = (item.price || 0) * (item.quantity || 1);
        total += lineTotal;
        eligibleTotal += lineTotal;
      }
    }

    if (items && Array.isArray(items) && items.length > 0 && eligibleTotal === 0) {
      return res.status(400).json({
        message: 'This promo code does not apply to the items in your cart',
      });
    }

    // Check minimum purchase
    if (total < promo.minPurchaseAmount) {
      return res.status(400).json({
        message: `Minimum purchase amount of ${promo.minPurchaseAmount} required for this promo code`,
      });
    }

    // Calculate discount
    let discountAmount;
    if (promo.discountType === 'percentage') {
      discountAmount = (total * promo.discountValue) / 100;
      if (promo.maxDiscountAmount > 0 && discountAmount > promo.maxDiscountAmount) {
        discountAmount = promo.maxDiscountAmount;
      }
    } else {
      discountAmount = promo.discountValue;
    }

    // CAP: a discount can never exceed what the buyer is paying, otherwise
    // checkout totals go NEGATIVE (a $100-off code on a $40 cart must
    // discount $40, not $100).
    discountAmount = Math.max(0, Math.min(discountAmount, total));

    res.json({
      valid: true,
      promo: {
        _id: promo._id,
        code: promo.code,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        discountAmount: Math.round(discountAmount * 100) / 100,
        eligibleTotal: Math.round(eligibleTotal * 100) / 100,
        description: promo.description,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/promos/:id/use - Mark promo code as used.
// GUARDS: a code that is inactive, expired, or past its usageLimit must not
// consume another use — the client calls this at checkout, so without the
// limit check a "limited" code kept working forever.
router.post('/:id/use', auth, async (req, res) => {
  try {
    const promo = await Promo.findById(req.params.id);
    if (!promo) return res.status(404).json({ message: 'Promo code not found' });

    if (!promo.isActive) {
      return res.status(400).json({ message: 'Promo code is not active' });
    }
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Promo code has expired' });
    }
    if (promo.usageLimit > 0 && promo.usageCount >= promo.usageLimit) {
      return res.status(400).json({ message: 'Promo code usage limit reached' });
    }

    promo.usageCount += 1;
    await promo.save();

    res.json({ message: 'Promo code used', usageCount: promo.usageCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;