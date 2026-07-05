const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Vendor = require('../models/Vendor');

// GET /api/vendors - Get user vendor listings
router.get('/', auth, async (req, res) => {
  try {
    const vendors = await Vendor.find({ 'sellers.seller': req.user._id })
      .populate('listing', 'title price images')
      .populate('sellers.seller', 'name');
    res.json(vendors);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch vendor listings' });
  }
});

// POST /api/vendors - Create vendor listing
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, commission } = req.body;
    
    const vendor = await Vendor.create({
      listing: listingId,
      sellers: [{ seller: req.user._id, commission, isPrimary: true }],
      sharedInventory: 0
    });

    res.status(201).json(vendor);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create vendor listing' });
  }
});

// POST /api/vendors/:id/invite - Invite co-vendor
router.post('/:id/invite', auth, async (req, res) => {
  try {
    const { sellerId, commission } = req.body;
    
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor listing not found' });
    }

    // Check if inviter is a seller on this listing
    const isSeller = vendor.sellers.some(s => s.seller.toString() === req.user._id.toString());
    if (!isSeller) {
      return res.status(403).json({ message: 'Not authorized to invite' });
    }

    vendor.sellers.push({ seller: sellerId, commission });
    await vendor.save();

    res.json(vendor);
  } catch (error) {
    res.status(500).json({ message: 'Failed to invite co-vendor' });
  }
});

// PUT /api/vendors/shared-inventory - Update shared inventory
router.put('/shared-inventory', auth, async (req, res) => {
  try {
    const { listingId, quantity } = req.body;
    
    const vendor = await Vendor.findOneAndUpdate(
      { listing: listingId, 'sellers.seller': req.user._id },
      { sharedInventory: quantity },
      { new: true }
    );

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor listing not found' });
    }

    res.json(vendor);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update shared inventory' });
  }
});

module.exports = router;