const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Offer = require('../models/Offer');
const Order = require('../models/Order');
const { auth } = require('../middleware/auth');
const { calculateShipping, getPreferredCarrier } = require('../config/shipping');
const { calculatePaymentBreakdown, authorizePaymentIntent } = require('../config/payments');
const { boostConfig } = require('../config/boost');

// Flat per-sale boost fee: price × tier.feePercent / 100
// Charged ONLY upon successful sale (never upfront)
const BOOST_FEE_TIERS = boostConfig.tiers;
const getBoostFee = (listing, salePrice = 0) => {
  if (!listing?.boost?.active) return 0;
  const tier = BOOST_FEE_TIERS[listing.boost.tier] || BOOST_FEE_TIERS.standard;
  return Math.round(salePrice * (tier.feePercent / 100) * 100) / 100;
};

// ITEM-LEVEL BOOST LEDGER: record a boost fee against the listing.
// The fee is deducted from the seller's earnings on THIS sale only,
// never subsidized from other earnings. Atomic so we never lose money.
// It is reversed only by the cancel/return lifecycle (see orderLifecycle).
const recordBoostFeeOwed = async (listingId, boostFee, saleQuantity = 1) => {
  if (!boostFee || boostFee <= 0) return null;
  const totalFee = Math.round(boostFee * saleQuantity * 100) / 100;
  return Listing.findByIdAndUpdate(
    listingId,
    { $inc: { 'boost.feeLedger.owed': totalFee } },
    { new: true }
  );
};

// POST /api/transactions/batch - Create payment intent for multi-seller checkout
// NOTE: Transactions are NOT created here. Payment is authorized first.
// Actual transaction creation happens in POST /api/payments/confirm-batch
// This endpoint only validates items and authorizes the payment.
router.post('/batch', auth, async (req, res) => {
  try {
    const { items, shippingAddress, buyerCountry } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'No items provided' });
    }

    let totalAmount = 0;
    const breakdowns = [];

    for (const item of items) {
      const listing = await Listing.findById(item.listingId);
      if (!listing) throw new Error(`Listing ${item.listingId} not found`);
      if (!listing.available || listing.sold || listing.quantity < item.quantity) {
        throw new Error(`Item "${listing.title}" is no longer available`);
      }

      const seller = await User.findById(listing.seller);
      const sellerCountry = seller?.country || listing.shipsFrom || 'US';
      const toCountry = buyerCountry || req.user.country || 'US';
      const weightKg = listing.weight || 0.5;

      const breakdown = calculatePaymentBreakdown(listing.price, sellerCountry, toCountry, weightKg);
      const itemTotal = breakdown.buyer.totalPaid * item.quantity;
      totalAmount += itemTotal;
      breakdowns.push(breakdown);
    }

    // Phase 1: Authorize payment FIRST (no money moves, just hold)
    const paymentIntent = await authorizePaymentIntent(
      totalAmount,
      'USD',
      {
        itemIds: items.map(i => i.listingId).join(','),
        buyerId: req.user._id.toString(),
      }
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      totalAmount,
      items: items.map((item, i) => ({
        listingId: item.listingId,
        breakdown: breakdowns[i],
      })),
    });
  } catch (error) {
    console.error('Batch transaction error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// POST /api/transactions - Create transaction (purchase) with full payment breakdown
  // POST /api/transactions/guest - Allow guest checkout without authentication
router.post('/guest', async (req, res) => {
  try {
    const { listingId, buyerEmail, buyerName, buyerPhone, shippingAddress, buyerCountry } = req.body;

    // Validate required fields
    if (!listingId || !buyerEmail || !buyerName || !shippingAddress) {
      return res.status(400).json({ message: 'Missing required fields: listingId, buyerEmail, buyerName, shippingAddress' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(buyerEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate shipping address
    if (!shippingAddress.fullName || !shippingAddress.street1 || !shippingAddress.city || 
        !shippingAddress.state || !shippingAddress.postalCode || !shippingAddress.country) {
      return res.status(400).json({ message: 'Complete shipping address is required' });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (listing.seller.toString() === buyerEmail) {
      return res.status(400).json({ message: 'Cannot purchase your own listing' });
    }

    if (!listing.available || listing.sold) {
      return res.status(400).json({ message: 'Listing is no longer available' });
    }
    if (listing.quantity <= 0) {
      return res.status(400).json({ message: 'Out of stock' });
    }

    // Create or find guest user
    let guestUser = await User.findOne({ email: buyerEmail.toLowerCase() });
    if (!guestUser) {
      guestUser = await User.create({
        name: buyerName,
        email: buyerEmail.toLowerCase(),
        password: null,
        emailVerified: true,
        authProvider: 'guest',
        country: shippingAddress.country || buyerCountry || 'US',
        currency: 'USD',
        shippingAddress: {
          fullName: buyerName,
          street1: shippingAddress.street1,
          street2: shippingAddress.street2 || '',
          city: shippingAddress.city,
          state: shippingAddress.state,
          postalCode: shippingAddress.postalCode,
          country: shippingAddress.country,
          phone: buyerPhone || shippingAddress.phone || '',
        },
        balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
        stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
      });
    }

    const seller = await User.findById(listing.seller);
    const sellerCountry = seller?.country || listing.shipsFrom || 'US';
    const buyerShipCountry = shippingAddress.country || buyerCountry || 'US';
    const weightKg = listing.weight || 0.5;

    const breakdown = calculatePaymentBreakdown(listing.price, sellerCountry, buyerShipCountry, weightKg);
    // Boost fee: flat % of sale price, charged only upon successful sale
    const boostFee = getBoostFee(listing, listing.price);

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
      buyer: guestUser._id,
      seller: listing.seller,
      itemPrice: listing.price,
      currency: listing.currency || 'USD',
      paymentBreakdown: {
        subtotal: breakdown.buyer.itemPrice,
        shippingCost: breakdown.buyer.shippingCost,
        buyerProtectionFee: breakdown.buyer.buyerProtectionFee,
        buyerProtectionPercent: breakdown.buyer.buyerProtectionPercent,
        tax: 0,
        totalPaid: breakdown.buyer.totalPaid,
        platformFee: breakdown.seller.platformFee,
        platformFeePercent: breakdown.seller.platformFeePercent,
        shippingPayout: breakdown.seller.shippingPayout,
        sellerEarnings: breakdown.seller.sellerEarnings - boostFee,
        boostFee,
        boostTier: listing.boost?.tier || '',
      },
      shippingAddress: {
        fullName: shippingAddress.fullName,
        street1: shippingAddress.street1,
        street2: shippingAddress.street2 || '',
        city: shippingAddress.city,
        state: shippingAddress.state,
        postalCode: shippingAddress.postalCode,
        country: buyerShipCountry,
        phone: buyerPhone || shippingAddress.phone || '',
      },
      sellerAddress,
      shipping: {
        weight: weightKg,
        carrier: getPreferredCarrier(buyerShipCountry, sellerCountry === buyerShipCountry),
        estimatedDelivery: new Date(Date.now() + (breakdown.shipping?.estimatedDays?.max || 7) * 24 * 60 * 60 * 1000),
      },
      payout: { status: 'pending' },
      autoTracking: {
        enabled: true,
        lastChecked: new Date(),
        nextCheck: new Date(Date.now() + 24 * 60 * 60 * 1000),
        attempts: 0,
      },
      status: 'paid',
    });

    // Atomic inventory update
    const wasLastOne = listing.quantity === 1;
    await Listing.findOneAndUpdate(
      { _id: listingId, quantity: { $gte: 1 } },
      { 
        $inc: { quantity: -1, quantitySold: 1 },
        $set: {
          available: listing.quantity > 1,
          sold: wasLastOne,
        }
      },
      { new: true }
    );

    // Item-level boost fee ledger (this listing only)
    await recordBoostFeeOwed(listing._id, boostFee, 1);

    // Update seller pending balance
    await User.findByIdAndUpdate(listing.seller, {
      $inc: { 'balance.pending': breakdown.seller.sellerEarnings - boostFee }
    });

    res.status(201).json({
      ...transaction.toObject(),
      buyer: {
        _id: guestUser._id,
        name: guestUser.name,
        email: guestUser.email,
        authProvider: guestUser.authProvider,
      },
    });
  } catch (error) {
    console.error('Guest transaction error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

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

    // Determine if there is an accepted offer for this buyer and listing (any accepted status).
    // If present, use its negotiated price instead of the listing's default price.
    // Also link the offer to the transaction for tracking.
    const existingOffer = await Offer.findOne({
      listing: listingId,
      buyer: req.user._id,
      status: 'accepted',
    });
    const finalPrice = existingOffer ? (existingOffer.counterAmount || existingOffer.amount) : listing.price;
    const isNegotiated = !!existingOffer;
    const negotiatedPrice = isNegotiated ? (existingOffer.counterAmount || existingOffer.amount) : null;

      // Get seller info for country
      const seller = await User.findById(listing.seller);
      const sellerCountry = seller?.country || listing.shipsFrom || 'US';
      const buyerShipCountry = shippingAddress?.country || buyerCountry || 'US';

      // Calculate weight
      const weightKg = listing.weight || 0.5;

      // Use the same calculation engine as the payment flow for consistency
      const breakdown = calculatePaymentBreakdown(finalPrice, sellerCountry, buyerShipCountry, weightKg);

    // Boost fee: only deducted if item is boosted AND sale completes
    const boostFee = getBoostFee(listing, finalPrice);

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
        itemPrice: finalPrice,
      currency: listing.currency || 'USD',
      paymentBreakdown: {
        subtotal: breakdown.buyer.itemPrice,
        shippingCost: breakdown.buyer.shippingCost,
        buyerProtectionFee: breakdown.buyer.buyerProtectionFee,
        buyerProtectionPercent: breakdown.buyer.buyerProtectionPercent,
        tax: 0,
        totalPaid: breakdown.buyer.totalPaid,
        platformFee: breakdown.seller.platformFee,
        platformFeePercent: breakdown.seller.platformFeePercent,
        shippingPayout: breakdown.seller.shippingPayout,
        sellerEarnings: breakdown.seller.sellerEarnings - boostFee,
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
      offer: isNegotiated ? existingOffer._id : null,
      negotiatedPrice,
      isNegotiated,
      sellerAddress,
      shipping: {
        weight: weightKg,
        carrier: getPreferredCarrier(buyerShipCountry, sellerCountry === buyerShipCountry),
        estimatedDelivery: new Date(Date.now() + (breakdown.shipping?.estimatedDays?.max || 7) * 24 * 60 * 60 * 1000),
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

    // BUG 2: Atomic inventory update with oversell protection
    // Check if this will be the last item to mark sold
    const wasLastOne = listing.quantity === 1;
    const inventoryUpdate = await Listing.findOneAndUpdate(
      {
        _id: listingId,
        quantity: { $gt: 0 },
      },
      {
        $inc: { quantity: -1, quantitySold: 1 },
        $set: wasLastOne ? { sold: true, available: false } : {},
      },
      { new: true }
    );

    // If null, someone else bought the last one concurrently
    if (!inventoryUpdate) {
      await Transaction.findByIdAndDelete(transaction._id);
      return res.status(400).json({ message: 'Sorry, this item just went out of stock' });
    }

    // Item-level boost fee ledger (this listing only)
    await recordBoostFeeOwed(listing._id, boostFee, 1);

    // Update seller's pending balance and notification
    const finalSellerEarnings = breakdown.seller.sellerEarnings - boostFee;
    if (seller) {
      seller.balance.pending = (seller.balance.pending || 0) + finalSellerEarnings;
      seller.notifications.unshift({
        type: 'sale',
        from: req.user._id,
        listing: listing._id,
        transaction: transaction._id,
        message: `Your item "${listing.title}" has been purchased for $${finalPrice}! You'll earn $${finalSellerEarnings} after platform fees.`,
      });
      await seller.save();
    }

    // Create the consolidated Enterprise Order for this checkout event
    // (one Order per purchase; the seller fulfills via order.shipments[0])
    await Order.create({
      buyer: req.user._id,
      sellers: [listing.seller],
      currency: listing.currency || 'USD',
      items: [{
        listing: listingId,
        transaction: transaction._id,
        seller: listing.seller,
        title: listing.title || '',
        price: finalPrice,
        quantity: 1,
        currency: listing.currency || 'USD',
        image: (listing.images || [])[0] || '',
        condition: listing.condition || '',
        size: listing.size || '',
        brand: listing.brand || '',
      }],
      shipments: [{
        seller: listing.seller,
        items: [transaction._id],
        shippingCost: breakdown.buyer.shippingCost,
        currency: listing.currency || 'USD',
        status: 'pending',
      }],
      totals: {
        subtotal: breakdown.buyer.itemPrice,
        shipping: breakdown.buyer.shippingCost,
        protectionFees: breakdown.buyer.buyerProtectionFee,
        discounts: 0,
        total: breakdown.buyer.totalPaid,
      },
      payment: {
        paymentIntentId: '',
        status: 'captured',
        currency: listing.currency || 'USD',
        totalHeld: breakdown.buyer.totalPaid,
      },
      status: 'confirmed',
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
    });

    await transaction.populate(['buyer', 'seller', 'listing']);
    res.status(201).json(transaction);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/transactions/offer/:offerId - Create a transaction based on an accepted offer (buyer has accepted seller's counter)
router.post('/offer/:offerId', auth, async (req, res) => {
  try {
    const { offerId } = req.params;
    const offer = await Offer.findById(offerId);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    // Ensure the caller is the buyer of the offer
    if (offer.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    // Offer must be in accepted state (meaning buyer has accepted seller's counter)
    if (offer.status !== 'accepted') {
      return res.status(400).json({ message: 'Offer not accepted yet' });
    }
    // Use the agreed price: counterAmount if present, otherwise original amount
    const finalPrice = offer.counterAmount || offer.amount;

    const listing = await Listing.findById(offer.listing);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (!listing.available || listing.sold || (listing.quantity !== undefined && listing.quantity <= 0)) {
      return res.status(400).json({ message: 'Listing not available for purchase' });
    }

    const seller = await User.findById(listing.seller);
    const sellerCountry = seller?.country || listing.shipsFrom || 'US';
    const buyerCountry = req.user.country || 'US';
    const weightKg = listing.weight || 0.5;
    const { calculateShipping } = require('../config/shipping');
    const { calculatePaymentBreakdown } = require('../config/payments');
    const shippingResult = calculateShipping(sellerCountry, buyerCountry, weightKg, finalPrice);
    const shippingCost = listing.shipping?.freeShipping ? 0 : shippingResult.cost;
    const breakdown = calculatePaymentBreakdown(finalPrice, sellerCountry, buyerCountry, weightKg);
    // Boost fee: flat % of sale price, charged only upon successful sale
    const boostFee = getBoostFee(listing, finalPrice);

    const transaction = await Transaction.create({
      listing: listing._id,
      buyer: req.user._id,
      seller: listing.seller,
      itemPrice: finalPrice,
      currency: listing.currency || 'USD',
      paymentBreakdown: {
        subtotal: breakdown.buyer.itemPrice,
        shippingCost,
        buyerProtectionFee: breakdown.buyer.buyerProtectionFee,
        buyerProtectionPercent: breakdown.buyer.buyerProtectionPercent,
        tax: 0,
        totalPaid: breakdown.buyer.totalPaid,
        platformFee: breakdown.seller.platformFee,
        platformFeePercent: breakdown.seller.platformFeePercent,
        shippingPayout: breakdown.seller.shippingPayout,
        sellerEarnings: breakdown.seller.sellerEarnings - boostFee,
        boostFee,
        boostTier: listing.boost?.tier || '',
      },
      shippingAddress: {
        fullName: req.user.name,
        country: buyerCountry,
      },
      offer: offer._id,
      negotiatedPrice: finalPrice,
      isNegotiated: true,
      status: 'paid',
      payout: { status: 'pending' },
      autoTracking: { enabled: true, lastChecked: new Date(), nextCheck: new Date(Date.now() + 86400000), attempts: 0 },
    });

    // BUG 2: Atomic inventory update with oversell protection
    const wasLastOne = listing.quantity === 1;
    const inventoryUpdate = await Listing.findOneAndUpdate(
      {
        _id: offer.listing,
        quantity: { $gt: 0 },
      },
      {
        $inc: { quantity: -1, quantitySold: 1 },
        $set: wasLastOne ? { sold: true, available: false } : {},
      },
      { new: true }
    );

    if (!inventoryUpdate) {
      await Transaction.findByIdAndDelete(transaction._id);
      return res.status(400).json({ message: 'Sorry, this item just went out of stock' });
    }

    // Item-level boost fee ledger (this listing only)
    await recordBoostFeeOwed(listing._id, boostFee, 1);

    // Update seller pending balance and notify in one save
    if (seller) {
      seller.balance.pending = (seller.balance.pending || 0) + (breakdown.seller.sellerEarnings - boostFee);
      seller.notifications.unshift({
        type: 'sale',
        from: req.user._id,
        listing: listing._id,
        transaction: transaction._id,
        message: `"${listing.title}" sold via offer for $${finalPrice}! You'll earn $${Math.round((breakdown.seller.sellerEarnings - boostFee) * 100) / 100} after platform fees.`,
      });
      await seller.save();
    }

    // Notify buyer of purchase
    const buyer = await User.findById(req.user._id);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'sale',
        from: req.user._id,
        listing: listing._id,
        transaction: transaction._id,
        message: `You purchased "${listing.title}" for $${finalPrice}`,
      });
      await buyer.save();
    }

    // Mark offer as completed (transaction has been created)
    offer.status = 'completed';
    await offer.save();

    res.status(201).json({ transaction, offer });
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