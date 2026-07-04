const express = require('express');
const router = express.Router();
const RecentlyViewed = require('../models/RecentlyViewed');
const { auth } = require('../middleware/auth');

// POST /api/recently-viewed/:listingId - Record a view
router.post('/:listingId', auth, async (req, res) => {
  try {
    const { listingId } = req.params;
    
    const recentView = new RecentlyViewed({
      userId: req.user._id,
      listingId,
    });
    
    await recentView.save();
    
    res.status(201).json({ success: true });
  } catch (error) {
    // Duplicate key error is expected - user already viewed this item
    if (error.code === 11000) {
      return res.status(200).json({ success: true, message: 'Already viewed' });
    }
    res.status(500).json({ message: 'Failed to record view' });
  }
});

// GET /api/recently-viewed - Get user's recently viewed listings
router.get('/', auth, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const recentViews = await RecentlyViewed.find({ userId: req.user._id })
      .sort({ viewedAt: -1 })
      .limit(parseInt(limit))
      .populate('listingId', 'title price images available category');
    
    res.json({
      items: recentViews.map(v => v.listingId),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch recently viewed' });
  }
});

// DELETE /api/recently-viewed/clear - Clear user's view history
router.delete('/clear', auth, async (req, res) => {
  try {
    await RecentlyViewed.deleteMany({ userId: req.user._id });
    res.json({ message: 'View history cleared' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to clear history' });
  }
});

// DELETE /api/recently-viewed/:listingId - Remove specific listing from history
router.delete('/:listingId', auth, async (req, res) => {
  try {
    await RecentlyViewed.deleteOne({
      userId: req.user._id,
      listingId: req.params.listingId,
    });
    res.json({ message: 'Removed from history' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove' });
  }
});

module.exports = router;