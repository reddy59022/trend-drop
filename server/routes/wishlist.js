const express = require('express');
const router = express.Router();
const Wishlist = require('../models/Wishlist');
const { auth } = require('../middleware/auth');

// GET /api/wishlist - Get user's wishlist
router.get('/', auth, async (req, res) => {
  try {
    let wishlist = await Wishlist.findOne({ user: req.user._id })
      .populate({ path: 'items.listing', populate: { path: 'seller', select: 'name avatar' } });
    if (!wishlist) wishlist = { items: [] };
    res.json(wishlist.items || []);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/wishlist - Add item to wishlist
router.post('/', auth, async (req, res) => {
  try {
    const { listingId } = req.body;
    let wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) {
      wishlist = await Wishlist.create({ user: req.user._id, items: [{ listing: listingId }] });
    } else {
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
      wishlist.items = wishlist.items.filter(i => i.listing.toString() !== req.params.listingId);
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
    const inWishlist = wishlist ? wishlist.items.some(i => i.listing.toString() === req.params.listingId) : false;
    res.json({ inWishlist });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;