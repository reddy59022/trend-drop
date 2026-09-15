const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');

// GET /api/offer-sharing/stats - Get sharing statistics
router.get('/stats', auth, async (req, res) => {
  try {
    // Get user's offers
    const offers = await Offer.find({ seller: req.user._id });
    const sharedOffers = offers.filter(o => o.sharedWithLikers);
    
    res.json({
      totalOffers: offers.length,
      sharedOffers: sharedOffers.length,
      totalShares: offers.reduce((sum, o) => sum + (o.likesCount || 0), 0),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch sharing stats' });
  }
});

// POST /api/offer-sharing/to-likers/:listingId - Share offer with all likers
router.post('/to-likers/:listingId', auth, async (req, res) => {
  try {
    const { listingId } = req.params;
    const { discountType, discountValue } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to share this listing' });
    }

    // GA-7: discount sanity (parity with POST /api/offers/to-likers).
    // discountValue:200 produced a NEGATIVE offer amount (500), and
    // discountValue:100 produced a $0 free-item offer.
    const offerDiscountType = discountType || 'percentage';
    if (!['percentage', 'fixed'].includes(offerDiscountType)) {
      return res.status(400).json({ message: 'discountType must be "percentage" or "fixed"' });
    }
    const numericDiscount = Number(discountValue === undefined || discountValue === null || discountValue === '' ? 10 : discountValue);
    if (!Number.isFinite(numericDiscount) || numericDiscount <= 0) {
      return res.status(400).json({ message: 'discountValue must be a positive number' });
    }
    if (offerDiscountType === 'percentage' && numericDiscount > 90) {
      return res.status(400).json({ message: 'Percentage discount cannot exceed 90%' });
    }
    if (offerDiscountType === 'fixed' && numericDiscount >= listing.price) {
      return res.status(400).json({ message: 'Fixed discount must be less than the listing price' });
    }

    // GA-7c: likers must not be handed offers on items that can no longer
    // be purchased.
    if (!listing.available || listing.sold) {
      return res.status(400).json({ message: 'Listing is no longer available' });
    }

    // Create offers for all likers
    const likers = listing.likes || [];
    const offers = [];

    for (const likerId of likers) {
      const amount = offerDiscountType === 'percentage'
        ? Math.round(listing.price * (1 - numericDiscount / 100) * 100) / 100
        : listing.price - numericDiscount;
      const offer = await Offer.create({
        listing: listingId,
        seller: req.user._id,
        buyer: likerId,
        amount,
        originalPrice: listing.price,
        status: 'pending',
        sharedWithLikers: true,
        discountType: offerDiscountType,
        discountValue: numericDiscount,
        currency: listing.currency || 'USD',
      });
      offers.push(offer);
    }
    
    // Mark listing as having shared offers
    listing.offerSharedAt = new Date();
    await listing.save();
    
    res.json({
      message: `Offers shared with ${offers.length} likers`,
      offersCount: offers.length,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to share offers' });
  }
});

// POST /api/offer-sharing/bundle/:listingIds - Create bundle offer for multiple listings
router.post('/bundle', auth, async (req, res) => {
  try {
    const { listingIds, buyerId } = req.body;

    if (!listingIds || listingIds.length < 2) {
      return res.status(400).json({ message: 'At least 2 listings required for bundle' });
    }

    // GA-7d: a bundle offer is an offer TO a buyer — without a valid buyer
    // id the create either 500s (ValidationError) or silently mangles the
    // recipient.
    if (!buyerId) {
      return res.status(400).json({ message: 'buyerId is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(buyerId)) {
      return res.status(400).json({ message: 'buyerId must be a valid id' });
    }

    // Verify all listings belong to user
    const listings = await Listing.find({ _id: { $in: listingIds } });
    const allBelongToUser = listings.every(l => l.seller.toString() === req.user._id.toString());
    if (!allBelongToUser) {
      return res.status(403).json({ message: 'Can only bundle your own listings' });
    }

    // GA-7e: every item in the bundle must still be purchasable — bundling
    // sold items produces an offer the buyer can never complete.
    const unavailable = listings.filter((l) => l.sold || !l.available);
    if (unavailable.length > 0) {
      return res.status(400).json({ message: 'One or more bundled listings are no longer available' });
    }
    if (listings.length !== listingIds.length) {
      return res.status(400).json({ message: 'One or more bundled listings were not found' });
    }

    const totalAmount = listings.reduce((sum, l) => sum + l.price, 0);
    const bundleDiscount = 0.9; // 10% discount on bundles

    const offer = await Offer.create({
      listing: listingIds[0], // Primary listing
      seller: req.user._id,
      buyer: buyerId,
      amount: totalAmount * bundleDiscount,
      originalPrice: totalAmount,
      status: 'pending',
      isBundle: true,
      bundleItems: listingIds,
      currency: listings[0].currency || 'USD',
    });

    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create bundle offer' });
  }
});

// POST /api/offer-sharing/share/:offerId - Share a specific offer
router.post('/share/:offerId', auth, async (req, res) => {
  try {
    const { offerId } = req.params;
    const { friendIds } = req.body;

    // GA-7f: friendIds must be a non-empty array of valid ids — a missing
    // value used to 500 (TypeError on for..of) and garbage ids 500'd on cast.
    if (!Array.isArray(friendIds) || friendIds.length === 0) {
      return res.status(400).json({ message: 'friendIds must be a non-empty array' });
    }
    if (friendIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ message: 'friendIds contains an invalid id' });
    }

    const offer = await Offer.findById(offerId);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (offer.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to share this offer' });
    }
    
    // Create new offers for friends
    const newOffers = [];
    for (const friendId of friendIds) {
      const newOffer = await Offer.create({
        listing: offer.listing,
        seller: offer.seller,
        buyer: friendId,
        amount: offer.amount,
        originalPrice: offer.originalPrice,
        status: 'pending',
        sharedFromOffer: offer._id,
      });
      newOffers.push(newOffer);
    }
    
    res.json({
      message: `Offer shared with ${newOffers.length} friends`,
      offers: newOffers,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to share offer' });
  }
});

module.exports = router;