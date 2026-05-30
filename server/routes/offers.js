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
    // Optional currency from client – default to listing currency
    const { currency } = req.body;

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

    // Validate currency if supplied
    const offerCurrency = currency || listing.currency || 'USD';
    if (currency && currency !== (listing.currency || 'USD')) {
      return res.status(400).json({ message: 'Currency mismatch with listing' });
    }

    const offer = await Offer.create({
      listing: listingId,
      buyer: req.user._id,
      seller: listing.seller,
      amount: Number(amount),
      currency: offerCurrency,
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
// Seller accepts the buyer's original offer. The offer status becomes "accepted" but the listing is NOT marked sold here.
router.patch('/:id/accept', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    // Only allow acceptance of a pending offer (not already countered)
    if (offer.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending offers can be accepted' });
    }
    offer.status = 'accepted';
    await offer.save();

    // Notify buyer – they now need to proceed to payment (handled via transaction route)
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Your offer of $${offer.amount} has been accepted! Please proceed to purchase.`,
      });
      await buyer.save();
    }
    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offers/:id/buyer-counter (buyer counters after seller's counter)
router.patch('/:id/buyer-counter', auth, async (req, res) => {
  try {
    const { counterAmount } = req.body;
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    // Only the buyer of this offer may propose a counter.
    if (offer.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    // Ensure a counter amount is provided.
    if (counterAmount === undefined || counterAmount === null) {
      return res.status(400).json({ message: 'Missing counter amount' });
    }
    const numericCounter = Number(counterAmount);
    if (isNaN(numericCounter) || numericCounter <= 0) {
      return res.status(400).json({ message: 'Invalid counter amount' });
    }
    // The new counter must be higher than the previous counter (or original offer amount if no prior counter).
    const previousAmount = offer.counterAmount || offer.amount;
    if (numericCounter <= previousAmount) {
      return res.status(400).json({
        message: `Your counter must be higher than the previous amount of $${previousAmount}`,
      });
    }
    // Update the offer with the new counter.
    offer.status = 'buyer_countered';
    offer.counterAmount = numericCounter;
    await offer.save();

    // Notify seller of new buyer counter
    const seller = await User.findById(offer.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `${req.user.name} countered your counter with $${counterAmount}`,
      });
      await seller.save();
    }
    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offers/:id/accept-counter
// Buyer accepts the seller's counter offer. This **does not** create a transaction immediately.
// The offer status is set to "accepted" and the buyer must complete payment via the
// dedicated transaction endpoint (`POST /api/transactions/offer/:offerId`).
router.patch('/:id/accept-counter', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    if (offer.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (offer.status !== 'countered') {
      return res.status(400).json({ message: 'Offer is not in countered state' });
    }
    // Mark as accepted – payment will be handled separately
    offer.status = 'accepted';
    await offer.save();
    res.json({ offer, message: 'Counter accepted. Complete payment via transaction endpoint.' });
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