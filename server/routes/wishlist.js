const express = require('express');
const router = express.Router();
const Wishlist = require('../models/Wishlist');
const Listing = require('../models/Listing');
const { auth } = require('../middleware/auth');

// GET /api/wishlist - Get user's wishlist
router.get('/', auth, async (req, res) => {
  try {
    let wishlist = await Wishlist.findOne({ user: req.user._id })
      .populate({ path: 'items.listing', populate: { path: 'seller', select: 'name avatar' } });
    if (!wishlist) wishlist = { items: [] };
    // GA-2 self-heal: entries written before the listingId guard (or with a
    // missing listing) would 500 the client render — drop them from the view.
    res.json((wishlist.items || []).filter((i) => i.listing));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/wishlist - Add item to wishlist
router.post('/', auth, async (req, res) => {
  try {
    const { listingId } = req.body;

    // GA-2: a wishlist entry MUST reference a listing. Without this guard a
    // missing id silently created a listing-less entry, and every subsequent
    // add/remove for that user 500s on `i.listing.toString()` (TypeError) —
    // the wishlist became permanently unusable.
    if (!listingId) {
      return res.status(400).json({ message: 'listingId is required' });
    }

    const listing = await Listing.findById(listingId).select('_id');
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    let wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) {
      wishlist = await Wishlist.create({ user: req.user._id, items: [{ listing: listingId }] });
    } else {
      // Drop legacy poisoned entries so the duplicate check cannot crash.
      wishlist.items = wishlist.items.filter((i) => i.listing);
      const exists = wishlist.items.find(i => i.listing.toString() === listingId);
      if (!exists) wishlist.items.push({ listing: listingId });
    }
    await wishlist.save();
    res.json({ message: 'Added to wishlist' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/wishlist/:listingId - Remove from wishlist
router.delete('/:listingId', auth, async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (wishlist) {
      // GA-2: guard listing-less legacy entries — `.toString()` on them is
      // what used to 500 the whole wishlist.
      wishlist.items = wishlist.items.filter(i => i.listing && i.listing.toString() !== req.params.listingId);
      await wishlist.save();
    }
    res.json({ message: 'Removed from wishlist' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/wishlist/check/:listingId - Check if in wishlist
router.get('/check/:listingId', auth, async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id });
    const inWishlist = wishlist
      ? wishlist.items.some(i => i.listing && i.listing.toString() === req.params.listingId)
      : false;
    res.json({ inWishlist });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;