const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');

// ============================================================
// OFFER STATE MACHINE (v14.0 - Full Counter-Offer Chain Support)
// ============================================================
// 
// pending ──→ accepted          (seller accepts original offer)
// pending ──→ countered         (seller counters)
// pending ──→ declined          (seller declines)
//
// countered ──→ accepted        (buyer accepts seller's counter)
// countered ──→ buyer_countered (buyer counters back)
//
// buyer_countered ──→ accepted  (seller accepts buyer's counter)
// buyer_countered ──→ countered (seller counters again)
// buyer_countered ──→ declined  (seller declines)
//
// CRITICAL: Counter-offers can go back and forth ANY number of times:
//   buyer offers → seller counters → buyer counters → seller counters → ... → accepted
//
// When accepted:
//   - acceptedPrice = the final agreed price
//   - acceptedAt = timestamp
//   - acceptedBy = who accepted ('buyer' or 'seller')
//   - Only the specific buyer can purchase at this price
// ============================================================

// POST /api/offers - Create offer
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, amount, message } = req.body;
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

    // Check if buyer already has an active offer on this listing
    const existingActiveOffer = await Offer.findOne({
      listing: listingId,
      buyer: req.user._id,
      status: { $in: ['pending', 'countered', 'buyer_countered'] },
    });
    if (existingActiveOffer) {
      return res.status(400).json({ 
        message: 'You already have an active offer on this listing',
        offer: existingActiveOffer,
      });
    }

    // Validate currency if supplied
    const offerCurrency = currency || listing.currency || 'USD';
    if (currency && currency !== (listing.currency || 'USD')) {
      return res.status(400).json({ message: 'Currency mismatch with listing' });
    }

    // Validate amount
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Invalid offer amount' });
    }

    const offer = await Offer.create({
      listing: listingId,
      buyer: req.user._id,
      seller: listing.seller,
      amount: numericAmount,
      currency: offerCurrency,
      buyerMessage: message || '',
      // Initialize counterHistory with the original offer
      counterHistory: [{
        amount: numericAmount,
        counteredBy: 'buyer',
        message: message || 'Initial offer',
      }],
      lastCounterBy: 'buyer',
    });

    // Add notification to seller
    const seller = await User.findById(listing.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: listing._id,
        message: `${req.user.name} made an offer of ${offerCurrency} ${numericAmount} on "${listing.title}"`,
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

// GET /api/offers/:id - Get single offer with full history
router.get('/:id', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id)
      .populate('buyer', 'name avatar')
      .populate('seller', 'name avatar')
      .populate('listing', 'title images price currency');

    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    // Only buyer or seller can view the offer
    if (offer.buyer._id.toString() !== req.user._id.toString() &&
        offer.seller._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/offers/listing/:listingId/buyer - Get buyer's offer for a specific listing
router.get('/listing/:listingId/buyer', auth, async (req, res) => {
  try {
    const offer = await Offer.findOne({
      listing: req.params.listingId,
      buyer: req.user._id,
    })
      .populate('listing', 'title images price currency')
      .sort({ createdAt: -1 });

    res.json(offer || null);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PATCH /api/offers/:id/accept
// Seller accepts the buyer's original offer (pending → accepted)
// CRITICAL: Sets acceptedPrice = offer.amount
// ============================================================
router.patch('/:id/accept', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (offer.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending offers can be accepted' });
    }

    // CRITICAL: Set the accepted price explicitly
    offer.status = 'accepted';
    offer.acceptedPrice = offer.amount; // The buyer's original offer amount
    offer.acceptedAt = new Date();
    offer.acceptedBy = 'seller';
    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Your offer of ${offer.currency || 'USD'} ${offer.acceptedPrice} has been accepted! Proceed to purchase.`,
      });
      await buyer.save();
    }

    await offer.populate(['buyer', 'seller', 'listing']);
    res.json({ offer, finalPrice: offer.acceptedPrice, message: 'Offer accepted.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PATCH /api/offers/:id/counter
// Seller counters the buyer's offer/counter
// State machine: pending|buyer_countered → countered
// CRITICAL: Pushes to counterHistory, sets lastCounterBy = 'seller'
// ============================================================
router.patch('/:id/counter', auth, async (req, res) => {
  try {
    const { counterAmount, message } = req.body;
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Validate state: seller can counter from pending or buyer_countered
    if (offer.status !== 'pending' && offer.status !== 'buyer_countered') {
      return res.status(400).json({ 
        message: 'Cannot counter in current state: ' + offer.status + '. Seller can counter from pending or buyer_countered states.' 
      });
    }

    // Validate counter amount
    const numericCounter = Number(counterAmount);
    if (isNaN(numericCounter) || numericCounter <= 0) {
      return res.status(400).json({ message: 'Invalid counter amount' });
    }

    // If countering buyer's counter, seller's counter must be higher
    if (offer.status === 'buyer_countered') {
      const buyerCounter = offer.counterAmount || offer.amount;
      if (numericCounter <= buyerCounter) {
        return res.status(400).json({
          message: `Your counter must be higher than the buyer's counter of ${offer.currency || 'USD'} ${buyerCounter}`,
        });
      }
    } else {
      // Countering original offer - must be between offer amount and listing price
      const listing = await Listing.findById(offer.listing);
      if (listing && numericCounter > listing.price) {
        return res.status(400).json({
          message: `Counter cannot exceed the listing price of ${offer.currency || 'USD'} ${listing.price}`,
        });
      }
      if (numericCounter <= offer.amount) {
        return res.status(400).json({
          message: `Counter must be higher than the buyer's offer of ${offer.currency || 'USD'} ${offer.amount}`,
        });
      }
    }

    // Update offer
    offer.status = 'countered';
    offer.counterAmount = numericCounter;
    offer.lastCounterBy = 'seller';
    
    // CRITICAL: Push to counter history
    offer.counterHistory.push({
      amount: numericCounter,
      counteredBy: 'seller',
      message: message || '',
    });
    
    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Seller countered your offer with ${offer.currency || 'USD'} ${numericCounter}`,
      });
      await buyer.save();
    }

    await offer.populate(['buyer', 'seller', 'listing']);
    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PATCH /api/offers/:id/buyer-counter
// Buyer counters the seller's counter
// State machine: countered → buyer_countered
// CRITICAL: Pushes to counterHistory, sets lastCounterBy = 'buyer'
// ============================================================
router.patch('/:id/buyer-counter', auth, async (req, res) => {
  try {
    const { counterAmount, message } = req.body;
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    if (offer.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (offer.status !== 'countered') {
      return res.status(400).json({ message: 'You can only counter when the seller has countered. Current status: ' + offer.status });
    }

    const numericCounter = Number(counterAmount);
    if (isNaN(numericCounter) || numericCounter <= 0) {
      return res.status(400).json({ message: 'Invalid counter amount' });
    }

    // Buyer's counter must be:
    // 1. Higher than their original offer (they're increasing their offer)
    // 2. Lower than the seller's counter (they're trying to meet in the middle)
    const sellerCounter = offer.counterAmount || offer.amount;
    if (numericCounter <= offer.amount) {
      return res.status(400).json({
        message: `Your counter must be higher than your original offer of ${offer.currency || 'USD'} ${offer.amount}`,
      });
    }
    if (numericCounter >= sellerCounter) {
      return res.status(400).json({
        message: `Your counter must be lower than the seller's counter of ${offer.currency || 'USD'} ${sellerCounter}. If you agree, use accept instead.`,
      });
    }

    // Update offer
    offer.status = 'buyer_countered';
    offer.counterAmount = numericCounter;
    offer.lastCounterBy = 'buyer';
    
    // CRITICAL: Push to counter history
    offer.counterHistory.push({
      amount: numericCounter,
      counteredBy: 'buyer',
      message: message || '',
    });
    
    await offer.save();

    // Notify seller
    const seller = await User.findById(offer.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `${req.user.name} countered with ${offer.currency || 'USD'} ${numericCounter}`,
      });
      await seller.save();
    }

    await offer.populate(['buyer', 'seller', 'listing']);
    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PATCH /api/offers/:id/accept-counter
// Buyer accepts the seller's counter offer
// State machine: countered → accepted
// CRITICAL: Sets acceptedPrice = counterAmount
// ============================================================
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
      return res.status(400).json({ message: 'The seller has not made a counter to accept. Current status: ' + offer.status });
    }

    // CRITICAL: Set the accepted price explicitly
    offer.status = 'accepted';
    offer.acceptedPrice = offer.counterAmount; // The seller's counter amount
    offer.acceptedAt = new Date();
    offer.acceptedBy = 'buyer';
    await offer.save();

    // Notify seller
    const seller = await User.findById(offer.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Buyer accepted your counter of ${offer.currency || 'USD'} ${offer.acceptedPrice}. Ready for purchase.`,
      });
      await seller.save();
    }

    await offer.populate(['buyer', 'seller', 'listing']);
    res.json({ offer, message: 'Counter accepted.', finalPrice: offer.acceptedPrice });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PATCH /api/offers/:id/seller-accept-buyer-counter
// Seller accepts the buyer's counter
// State machine: buyer_countered → accepted
// CRITICAL: Sets acceptedPrice = counterAmount
// ============================================================
router.patch('/:id/seller-accept-buyer-counter', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (offer.status !== 'buyer_countered') {
      return res.status(400).json({ message: 'Offer is not in buyer_countered state. Current status: ' + offer.status });
    }

    // CRITICAL: Set the accepted price explicitly
    offer.status = 'accepted';
    offer.acceptedPrice = offer.counterAmount; // The buyer's counter amount
    offer.acceptedAt = new Date();
    offer.acceptedBy = 'seller';
    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Your counter of ${offer.currency || 'USD'} ${offer.acceptedPrice} has been accepted! Proceed to purchase.`,
      });
      await buyer.save();
    }

    await offer.populate(['buyer', 'seller', 'listing']);
    res.json({ offer, message: 'Buyer counter accepted.', finalPrice: offer.acceptedPrice });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PATCH /api/offers/:id/seller-accept
// Seller accepts a pending offer (original offer price)
// State machine: pending → accepted
// CRITICAL: Sets acceptedPrice = offer.amount
// ============================================================
router.patch('/:id/seller-accept', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (offer.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending offers can be accepted' });
    }

    // CRITICAL: Set the accepted price explicitly
    offer.status = 'accepted';
    offer.acceptedPrice = offer.amount; // The buyer's original offer amount
    offer.acceptedAt = new Date();
    offer.acceptedBy = 'seller';
    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Your offer of ${offer.currency || 'USD'} ${offer.acceptedPrice} has been accepted! Proceed to purchase.`,
      });
      await buyer.save();
    }

    await offer.populate(['buyer', 'seller', 'listing']);
    res.json({ offer, message: 'Offer accepted.', finalPrice: offer.acceptedPrice });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PATCH /api/offers/:id/decline
// State machine: pending|buyer_countered → declined
// ============================================================
router.patch('/:id/decline', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (offer.status !== 'pending' && offer.status !== 'buyer_countered') {
      return res.status(400).json({ message: 'Cannot decline offer in current state: ' + offer.status });
    }

    offer.status = 'declined';
    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      const displayAmount = offer.counterAmount || offer.amount;
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Your ${offer.counterAmount ? 'counter of ' + (offer.currency || 'USD') + ' ' + displayAmount : 'offer of ' + (offer.currency || 'USD') + ' ' + offer.amount} has been declined.`,
      });
      await buyer.save();
    }

    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PATCH /api/offers/:id/complete
// Mark offer as completed after purchase
// State machine: accepted → completed
// ============================================================
router.patch('/:id/complete', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    // Only buyer or seller can complete
    if (offer.buyer.toString() !== req.user._id.toString() &&
        offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (offer.status !== 'accepted') {
      return res.status(400).json({ message: 'Only accepted offers can be completed' });
    }

    offer.status = 'completed';
    if (req.body.transactionId) {
      offer.transaction = req.body.transactionId;
    }
    await offer.save();

    res.json(offer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;