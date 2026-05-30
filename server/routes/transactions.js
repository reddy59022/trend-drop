const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { calculateShipping, getPreferredCarrier } = require('../config/shipping');

// POST /api/transactions - Create transaction (purchase) with full payment breakdown
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, shippingAddress, buyerCountry } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (listing.seller.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot purchase your own listing' });
    }

    if (!listing.available || listing.sold) {
      return res.status(400).json({ message: 'Listing is no longer available' });
    }
    if (listing.quantity <= 0) {
      return res.status(400).json({ message: 'Out of stock' });
    }

    // Get seller info for country
    const seller = await User.findById(listing.seller);
    const sellerCountry = seller?.country || listing.shipsFrom || 'US';
    const buyerShipCountry = shippingAddress?.country || buyerCountry || 'US';

    // Calculate shipping
    const weightKg = listing.weight || 0.5;
    const shippingResult = calculateShipping(sellerCountry, buyerShipCountry, weightKg, listing.price);
    const shippingCost = listing.shipping?.freeShipping ? 0 : shippingResult.cost;

    // Payment breakdown
    const platformFeePercent = 10;
    const buyerProtectionPercent = 5;
    const platformFee = Math.round(listing.price * (platformFeePercent / 100) * 100) / 100;
    const buyerProtectionFee = Math.round(listing.price * (buyerProtectionPercent / 100) * 100) / 100;
    const totalPaid = Math.round((listing.price + shippingCost + buyerProtectionFee) * 100) / 100;

    // Boost fee: only deducted if item is boosted AND sale completes
    // If order is cancelled/returned, no boost fee is charged
    const boostFee = (listing.boost?.active && listing.boost?.fee > 0) ? listing.boost.fee : 0;
    const sellerEarnings = Math.round((listing.price - platformFee - boostFee) * 100) / 100;

    // Get seller's address
    const sellerAddress = seller?.shippingAddress ? {
      street1: seller.shippingAddress.street1,
      street2: seller.shippingAddress.street2,
      city: seller.shippingAddress.city,
      state: seller.shippingAddress.state,
      postalCode: seller.shippingAddress.postalCode,
      country: seller.shippingAddress.country || sellerCountry,
    } : { country: sellerCountry };

    const transaction = await Transaction.create({
      listing: listingId,
      buyer: req.user._id,
      seller: listing.seller,
      itemPrice: listing.price,
      currency: listing.currency || 'USD',
      paymentBreakdown: {
        subtotal: listing.price,
        shippingCost,
        buyerProtectionFee,
        buyerProtectionPercent,
        tax: 0,
        totalPaid,
        platformFee,
      platformFeePercent,
      shippingPayout: shippingCost,
      sellerEarnings,
      boostFee,
      boostTier: listing.boost?.tier || '',
      },
      shippingAddress: {
        fullName: shippingAddress?.fullName || req.user.name,
        street1: shippingAddress?.street1,
        street2: shippingAddress?.street2,
        city: shippingAddress?.city,
        state: shippingAddress?.state,
        postalCode: shippingAddress?.postalCode,
        country: buyerShipCountry,
        phone: shippingAddress?.phone,
      },
      sellerAddress,
      shipping: {
        weight: weightKg,
        carrier: getPreferredCarrier(buyerShipCountry, sellerCountry === buyerShipCountry),
        estimatedDelivery: new Date(Date.now() + (shippingResult.estimatedDays?.max || 7) * 24 * 60 * 60 * 1000),
      },
      payout: {
        status: 'pending',
      },
      autoTracking: {
        enabled: true,
        lastChecked: new Date(),
        nextCheck: new Date(Date.now() + 24 * 60 * 60 * 1000),
        attempts: 0,
      },
      status: 'paid',
    });

    // Update inventory
    listing.quantity = Math.max(0, listing.quantity - 1);
    listing.quantitySold = (listing.quantitySold || 0) + 1;
    if (listing.quantity <= 0) {
      listing.sold = true;
      listing.available = false;
    }
    listing.paymentBreakdown = {
      sellerEarnings,
      platformFee,
      platformFeePercent,
      shippingCost,
      buyerTotal: totalPaid,
    };
    await listing.save();

    // Move seller's pending balance
    if (seller) {
      seller.balance.pending += sellerEarnings;
      seller.stats.totalListings = Math.max(0, (seller.stats.totalListings || 0));
      await seller.save();
    }

    // Notify seller
    if (seller) {
      seller.notifications.unshift({
        type: 'sale',
        from: req.user._id,
        listing: listing._id,
        transaction: transaction._id,
        message: `Your item "${listing.title}" has been purchased for $${listing.price}! You'll earn $${sellerEarnings} after platform fees.`,
      });
      await seller.save();
    }

    await transaction.populate(['buyer', 'seller', 'listing']);
    res.status(201).json(transaction);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/transactions - Get user's transactions
router.get('/', auth, async (req, res) => {
  try {
    const { type } = req.query; // 'bought' or 'sold'
    let query = { $or: [{ buyer: req.user._id }, { seller: req.user._id }] };
    if (type === 'bought') query = { buyer: req.user._id };
    if (type === 'sold') query = { seller: req.user._id };

    const transactions = await Transaction.find(query)
      .populate('buyer', 'name avatar country')
      .populate('seller', 'name avatar country')
      .populate('listing', 'title images price currency category brand')
      .sort({ createdAt: -1 });

    res.json(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/transactions/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('buyer', 'name avatar email country')
      .populate('seller', 'name avatar email country')
      .populate('listing', 'title images price description brand size condition currency shipsFrom weight');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (
      transaction.buyer._id.toString() !== req.user._id.toString() &&
      transaction.seller._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(transaction);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;