const express = require('express');
const router = express.Router();
const RecentlyViewed = require('../models/RecentlyViewed');
const { auth } = require('../middleware/auth');
const { asNumber } = require('../utils/validators');

// POST /api/recently-viewed/:listingId - Record a view
router.post('/:listingId', auth, async (req, res) => {
  try {
    const { listingId } = req.params;

    // The listing must exist: a valid-but-nonexistent id would otherwise
    // persist an orphan view row whose populated listing resolves to null.
    const Listing = require('../models/Listing');
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    // Check-then-create: return 200 "Already viewed" when a record exists.
    // (The unique index below is a backstop for races — two concurrent
    // creates can still race past the check, in which case the loser's
    // duplicate-key error maps to the same 200 response.)
    //
    // TDD R31-1: a re-view must REFRESH viewedAt. The history endpoint sorts
    // by viewedAt descending, so without this the "Recently Viewed" page
    // showed first-view order forever — re-visiting an item never surfaced
    // it again at the top. The API contract is unchanged: a re-view stays a
    // 200 "Already viewed" acknowledgement and never creates a second record.
    const refreshed = await RecentlyViewed.findOneAndUpdate(
      { userId: req.user._id, listingId },
      { $set: { viewedAt: new Date() } },
      { new: true }
    );
    if (refreshed) {
      return res.status(200).json({ success: true, message: 'Already viewed' });
    }

    const recentView = new RecentlyViewed({
      userId: req.user._id,
      listingId,
    });

    await recentView.save();

    res.status(201).json({ success: true });
  } catch (error) {
    // Duplicate key error is expected - user already viewed this item
    // (race between the check above and the insert; unique index wins).
    if (error.code === 11000) {
      return res.status(200).json({ success: true, message: 'Already viewed' });
    }
    res.status(500).json({ message: 'Failed to record view' });
  }
});

// GET /api/recently-viewed - Get user's recently viewed listings
router.get('/', auth, async (req, res) => {
  try {
    // Clamp the page size to the platform max (50) — an unbounded ?limit lets
    // a caller pull the entire history in one request (resource exhaustion).
    // Canonical pattern from routes/trends.js; a non-numeric limit falls back
    // to the 20 default instead of reaching .limit() as NaN.
    const limit = Math.max(1, Math.min(asNumber(req.query.limit, 20) || 20, 50));

    const recentViews = await RecentlyViewed.find({ userId: req.user._id })
      .sort({ viewedAt: -1 })
      .limit(limit)
      .populate('listingId', 'title price images available category');

    // Drop entries whose listing was since deleted (populate resolves to null):
    // a null in the array crashes/shrinks the client grid. Same self-heal the
    // wishlist endpoint performs (see routes/wishlist.js).
    res.json({
      items: recentViews.map(v => v.listingId).filter(Boolean),
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