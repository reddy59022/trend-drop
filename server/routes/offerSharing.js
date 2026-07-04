const express = require('express');
const router = express.Router();
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
    
    // Create offers for all likers
    const likers = listing.likes || [];
    const offers = [];
    
    for (const likerId of likers) {
      const offer = await Offer.create({
        listing: listingId,
        seller: req.user._id,
        buyer: likerId,
        amount: listing.price * (1 - (discountValue || 10) / 100),
        originalPrice: listing.price,
        status: 'pending',
        sharedWithLikers: true,
        discountType: discountType || 'percentage',
        discountValue: discountValue || 10,
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
    
    // Verify all listings belong to user
    const listings = await Listing.find({ _id: { $in: listingIds } });
    const allBelongToUser = listings.every(l => l.seller.toString() === req.user._id.toString());
    if (!allBelongToUser) {
      return res.status(403).json({ message: 'Can only bundle your own listings' });
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