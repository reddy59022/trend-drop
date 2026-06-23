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

// ============================================================
// BUNDLE DISCOUNTS (Section 28a)
// MUST be before /:id routes to avoid "bundle" being caught as ObjectId
// ============================================================
const BundleRule = require('../models/BundleRule');

// POST /api/offers/bundle - Create bundle discount rule
router.post('/bundle', auth, async (req, res) => {
  try {
    const { name, minQuantity, discountPercent, applicableCategories, description, maxApplications, expiresAt } = req.body;

    if (!name || !discountPercent) {
      return res.status(400).json({ message: 'Name and discount percent are required' });
    }

    const rule = await BundleRule.create({
      seller: req.user._id,
      name,
      minQuantity: minQuantity || 2,
      discountPercent,
      applicableCategories: applicableCategories || [],
      description: description || '',
      maxApplications: maxApplications || 0,
      expiresAt: expiresAt || null,
    });

    res.status(201).json(rule);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/offers/bundle - List seller's bundle rules
router.get('/bundle', auth, async (req, res) => {
  try {
    const rules = await BundleRule.find({ seller: req.user._id }).sort({ createdAt: -1 });
    res.json(rules);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/offers/bundle/:id - Update bundle rule
router.put('/bundle/:id', auth, async (req, res) => {
  try {
    const rule = await BundleRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ message: 'Bundle rule not found' });
    if (rule.seller.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });

    const { name, minQuantity, discountPercent, applicableCategories, description, maxApplications, isActive, expiresAt } = req.body;
    if (name) rule.name = name;
    if (minQuantity) rule.minQuantity = minQuantity;
    if (discountPercent) rule.discountPercent = discountPercent;
    if (applicableCategories) rule.applicableCategories = applicableCategories;
    if (description !== undefined) rule.description = description;
    if (maxApplications !== undefined) rule.maxApplications = maxApplications;
    if (isActive !== undefined) rule.isActive = isActive;
    if (expiresAt !== undefined) rule.expiresAt = expiresAt;

    await rule.save();
    res.json(rule);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/offers/bundle/:id - Delete bundle rule
router.delete('/bundle/:id', auth, async (req, res) => {
  try {
    const rule = await BundleRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ message: 'Bundle rule not found' });
    if (rule.seller.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });

    await BundleRule.deleteOne({ _id: req.params.id });
    res.json({ message: 'Bundle rule deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/offers/bundle/apply - Calculate eligible discounts for cart
router.post('/bundle/apply', auth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items array is required' });
    }

    const Listing = require('../models/Listing');
    const listingIds = items.map(i => i.listingId);
    const listings = await Listing.find({ _id: { $in: listingIds } });

    const sellerGroups = {};
    for (const item of items) {
      const listing = listings.find(l => l._id.toString() === item.listingId);
      if (!listing) continue;
      const sellerId = listing.seller.toString();
      if (!sellerGroups[sellerId]) sellerGroups[sellerId] = { seller: sellerId, items: [], totalPrice: 0, totalQuantity: 0 };
      sellerGroups[sellerId].items.push({ ...item, category: listing.category, title: listing.title });
      sellerGroups[sellerId].totalPrice += (item.price || 0) * (item.quantity || 1);
      sellerGroups[sellerId].totalQuantity += item.quantity || 1;
    }

    const discounts = [];
    for (const [, group] of Object.entries(sellerGroups)) {
      const rules = await BundleRule.find({
        seller: group.seller,
        isActive: true,
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      });

      for (const rule of rules) {
        let eligibleItems = group.items;
        if (rule.applicableCategories && rule.applicableCategories.length > 0) {
          eligibleItems = group.items.filter(i => rule.applicableCategories.includes(i.category));
        }
        const eligibleQuantity = eligibleItems.reduce((sum, i) => sum + (i.quantity || 1), 0);
        const eligibleTotal = eligibleItems.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);

        if (eligibleQuantity >= rule.minQuantity) {
          const discountAmount = (eligibleTotal * rule.discountPercent) / 100;
          discounts.push({ ruleId: rule._id, ruleName: rule.name, sellerId: group.seller, discountPercent: rule.discountPercent, discountAmount, eligibleQuantity, eligibleTotal, description: rule.description });
        }
      }
    }

    const totalBundleDiscount = discounts.reduce((sum, d) => sum + d.discountAmount, 0);
    res.json({
      discounts,
      totalBundleDiscount,
      message: discounts.length > 0 ? `Bundle discounts applied! Save ${totalBundleDiscount.toFixed(2)}` : 'No bundle discounts available for these items',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// OFFERS TO LIKERS (Section 28b) — MUST be before /:id routes
// ============================================================

// POST /api/offers/to-likers - Send bulk discount to listing likers
router.post('/to-likers', auth, async (req, res) => {
  try {
    const { listingId, discountType, discountValue, validHours } = req.body;
    if (!listingId || !discountType || !discountValue) {
      return res.status(400).json({ message: 'listingId, discountType, and discountValue are required' });
    }
    if (!['percentage', 'fixed'].includes(discountType)) {
      return res.status(400).json({ message: 'discountType must be "percentage" or "fixed"' });
    }

    const Listing = require('../models/Listing');
    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.seller.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const existingBulkOffer = await Offer.findOne({ seller: req.user._id, 'bulkOffer.isBulk': true, createdAt: { $gt: oneWeekAgo } });
    if (existingBulkOffer) return res.status(400).json({ message: 'You can only send one bulk offer per week' });

    let discountedPrice;
    if (discountType === 'percentage') {
      discountedPrice = listing.price - (listing.price * discountValue / 100);
    } else {
      discountedPrice = Math.max(1, listing.price - discountValue);
    }

    const bulkOffer = await Offer.create({
      listing: listingId,
      buyer: req.user._id,
      seller: req.user._id,
      amount: discountedPrice,
      status: 'pending',
      currency: listing.currency || 'USD',
      expiresAt: new Date(Date.now() + (validHours || 48) * 60 * 60 * 1000),
      bulkOffer: { isBulk: true, discountType, discountValue, claimedBy: [] },
    });

    const User = require('../models/User');
    const likers = await User.find({ _id: { $in: listing.likes || [] } });
    await Promise.all(likers.map(liker => {
      liker.notifications.unshift({ type: 'offer', from: req.user._id, listing: listing._id, message: `Exclusive offer! ${discountType === 'percentage' ? discountValue + '% off' : '$' + discountValue + ' off'} "${listing.title}" — limited time!` });
      return liker.save();
    }));

    res.status(201).json({ message: `Offer sent to ${likers.length} likers`, offer: bulkOffer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/offers/bulk/:listingId - View bulk offers for a listing
router.get('/bulk/:listingId', auth, async (req, res) => {
  try {
    const offers = await Offer.find({ listing: req.params.listingId, 'bulkOffer.isBulk': true, seller: req.user._id }).sort({ createdAt: -1 });
    res.json(offers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/offers/to-likers/:offerId/claim - Liker claims exclusive offer
router.post('/to-likers/:offerId/claim', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.offerId);
    if (!offer) return res.status(404).json({ message: 'Offer not found' });
    if (!offer.bulkOffer || !offer.bulkOffer.isBulk) return res.status(400).json({ message: 'Not a bulk offer' });
    if (offer.expiresAt && offer.expiresAt < new Date()) return res.status(400).json({ message: 'Offer has expired' });
    if (offer.bulkOffer.claimedBy.includes(req.user._id)) return res.status(400).json({ message: 'You have already claimed this offer' });

    const claimedOffer = await Offer.create({
      listing: offer.listing, buyer: req.user._id, seller: offer.seller, amount: offer.amount,
      status: 'accepted', acceptedPrice: offer.amount, acceptedAt: new Date(), acceptedBy: 'seller',
      currency: offer.currency, expiresAt: offer.expiresAt,
    });

    offer.bulkOffer.claimedBy.push(req.user._id);
    await offer.save();

    res.status(201).json({ message: 'Offer claimed! You can now purchase at the discounted price.', offer: claimedOffer });
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
