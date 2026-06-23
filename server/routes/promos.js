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
    if (discountType) promo.discountType = discountType;
    if (discountValue) promo.discountValue = discountValue;
    if (minPurchaseAmount !== undefined) promo.minPurchaseAmount = minPurchaseAmount;
    if (maxDiscountAmount !== undefined) promo.maxDiscountAmount = maxDiscountAmount;
    if (expiresAt !== undefined) promo.expiresAt = expiresAt;
    if (usageLimit !== undefined) promo.usageLimit = usageLimit;
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

    // Calculate total
    let total = 0;
    if (items && Array.isArray(items)) {
      for (const item of items) {
        // Check category restriction
        if (promo.applicableCategories && promo.applicableCategories.length > 0) {
          const listing = await Listing.findById(item.listingId);
          if (listing && !promo.applicableCategories.includes(listing.category)) continue;
        }
        total += (item.price || 0) * (item.quantity || 1);
      }
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

    res.json({
      valid: true,
      promo: {
        _id: promo._id,
        code: promo.code,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        discountAmount: Math.round(discountAmount * 100) / 100,
        description: promo.description,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/promos/:id/use - Mark promo code as used
router.post('/:id/use', auth, async (req, res) => {
  try {
    const promo = await Promo.findById(req.params.id);
    if (!promo) return res.status(404).json({ message: 'Promo code not found' });

    promo.usageCount += 1;
    await promo.save();

    res.json({ message: 'Promo code used', usageCount: promo.usageCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;