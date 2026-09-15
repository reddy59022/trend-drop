const express = require('express');
const router = express.Router();
const PriceHistory = require('../models/PriceHistory');
const { auth } = require('../middleware/auth');

// POST /api/pricehistory - Track price change (listing seller only: this is
// buyer-facing proof and drives price-drop notifications, so strangers must
// not be able to forge fake drops on another seller's listing).
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, price } = req.body;
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice < 1) {
      return res.status(400).json({ message: 'Price must be a number of at least 1' });
    }
    const Listing = require('../models/Listing');
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the listing seller can record price history' });
    }
    const record = await PriceHistory.create({ listing: listingId, price: numericPrice });
    res.status(201).json(record);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/pricehistory/:listingId - Get price history for a listing
router.get('/:listingId', async (req, res) => {
  try {
    const history = await PriceHistory.find({ listing: req.params.listingId })
      .sort({ createdAt: -1 })
      .limit(20);
    res.json(history);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;