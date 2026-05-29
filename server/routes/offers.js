const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// POST /api/offers - Create offer
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, amount } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (listing.seller.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot offer on your own listing' });
    }

    if (!listing.available || listing.sold) {
      return res.status(400).json({ message: 'Listing is no longer available' });
    }

    const offer = await Offer.create({
      listing: listingId,
      buyer: req.user._id,
      seller: listing.seller,
      amount: Number(amount),
    });

    // Add notification to seller
    const seller = await User.findById(listing.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: listing._id,
        message: `${req.user.name} made an offer of $${amount} on "${listing.title}"`,
      });
      await seller.save();
    }

    await offer.populate(['buyer', 'seller', 'listing']);
    res.status(201).json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/offers/received
router.get('/received', auth, async (req, res) => {
  try {
    const offers = await Offer.find({ seller: req.user._id })
      .populate('buyer', 'name avatar')
      .populate('listing', 'title images price')
      .sort({ createdAt: -1 });

    res.json(offers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/offers/sent
router.get('/sent', auth, async (req, res) => {
  try {
    const offers = await Offer.find({ buyer: req.user._id })
      .populate('seller', 'name avatar')
      .populate('listing', 'title images price')
      .sort({ createdAt: -1 });

    res.json(offers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offers/:id/accept
router.patch('/:id/accept', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    offer.status = 'accepted';
    await offer.save();

    // Update listing
    await Listing.findByIdAndUpdate(offer.listing, {
      available: false,
      sold: true,
    });

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Your offer of $${offer.amount} has been accepted!`,
      });
      await buyer.save();
    }

    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offers/:id/decline
router.patch('/:id/decline', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    offer.status = 'declined';
    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Your offer of $${offer.amount} has been declined.`,
      });
      await buyer.save();
    }

    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offers/:id/counter
router.patch('/:id/counter', auth, async (req, res) => {
  try {
    const { counterAmount } = req.body;
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    offer.status = 'countered';
    offer.counterAmount = Number(counterAmount);
    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `${req.user.name} countered your offer with $${counterAmount}`,
      });
      await buyer.save();
    }

    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;