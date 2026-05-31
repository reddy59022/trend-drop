const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Transaction = require('../models/Transaction'); // needed for creating a transaction after offer acceptance
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
// State machine: pending → accepted
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
        message: `Your offer of ${offer.currency ? offer.currency + ' ' : '$'}${offer.amount} has been accepted! Please proceed to purchase.`,
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
// State machine: countered → buyer_countered
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
    // Validate state: buyer can only counter when seller has countered
    if (offer.status !== 'countered') {
      return res.status(400).json({ message: 'You can only counter when the seller has countered. Current status: ' + offer.status });
    }
    // Ensure a counter amount is provided.
    if (counterAmount === undefined || counterAmount === null) {
      return res.status(400).json({ message: 'Missing counter amount' });
    }
    const numericCounter = Number(counterAmount);
    if (isNaN(numericCounter) || numericCounter <= 0) {
      return res.status(400).json({ message: 'Invalid counter amount' });
    }
    // Validate currency: counter amount must use the offer's currency
    if (offer.currency) {
      // Basic check: ensure counter is reasonable for the currency (no-op for now, could add more)
    }
    // The new counter must be higher than the seller's counter
    const sellerCounter = offer.counterAmount || offer.amount;
    if (numericCounter <= sellerCounter) {
      return res.status(400).json({
        message: `Your counter must be higher than the seller's counter of ${offer.currency || 'USD'} ${sellerCounter}`,
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
        message: `${req.user.name} countered your counter with ${offer.currency || 'USD'} ${counterAmount}`,
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
// Buyer accepts the seller's counter offer (status: 'countered')
// The negotiated price = counterAmount (if set) or offer.amount
// State machine: countered → accepted
router.patch('/:id/accept-counter', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    if (offer.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    // Buyer can only accept when seller has the active counter (countered state)
    // NOT buyer_countered - that's the buyer's OWN counter, they can't accept it
    if (offer.status !== 'countered') {
      return res.status(400).json({ message: 'The seller has not made a counter to accept. Current status: ' + offer.status });
    }
    // Mark as accepted – payment will be handled separately
    offer.status = 'accepted';
    // The final price is the counterAmount (what they negotiated to)
    // offer.counterAmount holds the final agreed price
    await offer.save();

      // Notify seller
      const seller = await User.findById(offer.seller);
      const finalPrice = offer.counterAmount || offer.amount;
      if (seller) {
        seller.notifications.unshift({
          type: 'offer',
          from: req.user._id,
          listing: offer.listing,
          message: `Buyer accepted your counter of ${offer.currency || 'USD'} ${finalPrice}. Ready for purchase.`,
        });
        await seller.save();
      }
      // Do not create a transaction here. The buyer will create a transaction
      // later (e.g., via the direct purchase endpoint or the `/api/transactions/offer/:offerId`
      // endpoint) using the accepted price stored in the offer.
      res.json({ offer, message: 'Counter accepted.', finalPrice });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offers/:id/seller-accept-buyer-counter
// Seller accepts the buyer's counter (status: 'buyer_countered' → 'accepted')
// State machine: buyer_countered → accepted
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
    // Accept the buyer's counter amount as the final negotiated price
    offer.status = 'accepted';
    await offer.save();

    // Notify buyer - they now need to proceed to payment at the negotiated price
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      const finalPrice = offer.counterAmount || offer.amount;
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Your counter of ${offer.currency || 'USD'} ${finalPrice} has been accepted! Proceed to purchase.`,
      });
      await buyer.save();
    }

    res.json({ offer, message: 'Buyer counter accepted.', finalPrice: offer.counterAmount || offer.amount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offers/:id/decline
// State machine: pending|buyer_countered → declined
router.patch('/:id/decline', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Allow declining from pending (original offer) or buyer_countered (buyer's counter)
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

// PATCH /api/offers/:id/seller-accept
// Seller accepts a pending offer (original offer price)
// State machine: pending → accepted
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
    offer.status = 'accepted';
    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `Your offer of ${offer.currency || 'USD'} ${offer.amount} has been accepted! Proceed to purchase.`,
      });
      await buyer.save();
    }

    res.json({ offer, message: 'Offer accepted.', finalPrice: offer.amount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offers/:id/counter
// Seller counters with a new price
// State machine: pending|buyer_countered → countered
// Invalid states: countered (already countered, wait for buyer), accepted, declined, completed, expired
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

    // Validate state: seller can counter from pending (original offer) or buyer_countered (buyer's counter)
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

    // If countering buyer's counter, must be higher than buyer's counter
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

    offer.status = 'countered';
    offer.counterAmount = numericCounter;
    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'offer',
        from: req.user._id,
        listing: offer.listing,
        message: `${req.user.name} countered your offer with ${offer.currency || 'USD'} ${numericCounter}`,
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