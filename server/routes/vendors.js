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

// POST /api/vendors - Create vendor listing (listing seller only, with
// validated commission split: strangers must not claim others' listings).
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, commission } = req.body;
    const numericCommission = Number(commission);
    if (!Number.isFinite(numericCommission) || numericCommission < 0 || numericCommission > 100) {
      return res.status(400).json({ message: 'Commission must be a number between 0 and 100' });
    }
    const Listing = require('../models/Listing');
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the listing seller can open a vendor row' });
    }

    const vendor = await Vendor.create({
      listing: listingId,
      sellers: [{ seller: req.user._id, commission: numericCommission, isPrimary: true }],
      sharedInventory: 0
    });

    res.status(201).json(vendor);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create vendor listing' });
  }
});

// POST /api/vendors/:id/invite - Invite co-vendor (members only; validated
// member + commission so rows cannot duplicate, ghost users cannot join,
// and splits stay within 0-100).
router.post('/:id/invite', auth, async (req, res) => {
  try {
    const { sellerId, commission } = req.body;
    const numericCommission = Number(commission);
    if (!Number.isFinite(numericCommission) || numericCommission < 0 || numericCommission > 100) {
      return res.status(400).json({ message: 'Commission must be a number between 0 and 100' });
    }

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor listing not found' });
    }

    // Check if inviter is a seller on this listing
    const isSeller = vendor.sellers.some(s => s.seller.toString() === req.user._id.toString());
    if (!isSeller) {
      return res.status(403).json({ message: 'Not authorized to invite' });
    }

    const User = require('../models/User');
    const invited = await User.findById(sellerId);
    if (!invited) {
      return res.status(404).json({ message: 'Seller not found' });
    }
    if (vendor.sellers.some((s) => s.seller.toString() === invited._id.toString())) {
      return res.status(400).json({ message: 'Seller is already a vendor member' });
    }

    vendor.sellers.push({ seller: invited._id, commission: numericCommission });
    await vendor.save();

    res.json(vendor);
  } catch (error) {
    res.status(500).json({ message: 'Failed to invite co-vendor' });
  }
});

// PUT /api/vendors/shared-inventory - Update shared inventory (validated:
// finite integer >= 0 so stock can never go negative or NaN via the API).
router.put('/shared-inventory', auth, async (req, res) => {
  try {
    const { listingId, quantity } = req.body;
    const numericQty = Number(quantity);
    if (!Number.isInteger(numericQty) || numericQty < 0) {
      return res.status(400).json({ message: 'Quantity must be an integer of 0 or more' });
    }

    const vendor = await Vendor.findOneAndUpdate(
      { listing: listingId, 'sellers.seller': req.user._id },
      { sharedInventory: numericQty },
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