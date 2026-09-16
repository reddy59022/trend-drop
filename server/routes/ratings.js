const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Rating = require('../models/Rating');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');

// POST /api/ratings - Create a rating for a purchased listing
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, rating, review } = req.body;
    // Validate body ids/values BEFORE querying: a malformed listingId would
    // otherwise throw a CastError that this local catch turns into a 500
    // (bypassing the global CastError->400 error mapping).
    if (!listingId || !mongoose.Types.ObjectId.isValid(String(listingId))) {
      return res.status(400).json({ message: 'Invalid listingId' });
    }
    if (review !== undefined && review !== null && (typeof review !== 'string' || review.length > 1000)) {
      return res.status(400).json({ message: 'Review must be a string of 1000 characters or fewer' });
    }
    const numericRating = Number(rating);
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ message: 'Rating must be a number between 1 and 5' });
    }
    const txn = await Transaction.findOne({ listing: listingId, buyer: req.user._id, status: 'completed' });
    if (!txn) {
      return res.status(400).json({ message: 'You can only review items you have purchased' });
    }
    const existing = await Rating.findOne({ reviewer: req.user._id, listing: listingId });
    if (existing) {
      return res.status(400).json({ message: 'You have already reviewed this item' });
    }
    const newRating = await Rating.create({
      listing: listingId,
      reviewer: req.user._id,
      seller: txn.seller,
      rating: numericRating,
      review: review || '',
    });
    await newRating.populate(['reviewer', 'listing']);
    res.status(201).json(newRating);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/ratings/seller/:sellerId
router.get('/seller/:sellerId', async (req, res) => {
  try {
    let sellerObjId;
    try {
      sellerObjId = new (require('mongoose').Types.ObjectId)(req.params.sellerId);
    } catch (e) {
      return res.json({ averageRating: 0, count: 0, ratings: [] });
    }
    const stats = await Rating.aggregate([
      { $match: { seller: sellerObjId } },
      { $group: { _id: null, averageRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const ratings = await Rating.find({ seller: req.params.sellerId })
      .populate('reviewer', 'name avatar')
      .populate('listing', 'title images')
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({
      averageRating: stats[0]?.averageRating || 0,
      count: stats[0]?.count || 0,
      ratings,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/ratings/listing/:listingId
router.get('/listing/:listingId', async (req, res) => {
  try {
    // A malformed id throws a CastError that the local catch would turn into
    // a 500 — answer 400 before touching the DB.
    if (!mongoose.Types.ObjectId.isValid(req.params.listingId)) {
      return res.status(400).json({ message: 'Invalid listingId' });
    }
    const ratings = await Rating.find({ listing: req.params.listingId })
      .populate('reviewer', 'name avatar')
      .sort({ createdAt: -1 });
    res.json(ratings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/ratings/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const rating = await Rating.findById(req.params.id);
    if (!rating) return res.status(404).json({ message: 'Rating not found' });
    if (rating.reviewer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    await rating.deleteOne();
    res.json({ message: 'Rating deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;