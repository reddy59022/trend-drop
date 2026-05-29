const express = require('express');
const router = express.Router();
const PriceHistory = require('../models/PriceHistory');
const { auth } = require('../middleware/auth');

// POST /api/pricehistory - Track price change
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, price } = req.body;
    const record = await PriceHistory.create({ listing: listingId, price: Number(price) });
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