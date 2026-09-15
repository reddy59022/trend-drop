const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Offer = require('../models/Offer');
const Order = require('../models/Order');
const { auth } = require('../middleware/auth');
const { calculateShipping, getPreferredCarrier } = require('../config/shipping');
const { calculatePaymentBreakdown, authorizePaymentIntent, findPaymentIntent, verifyIntentBinding } = require('../config/payments');
const { boostConfig } = require('../config/boost');
const { createPurchaseRollback } = require('../utils/purchaseRollback');

// TDD-B1: legacy transaction endpoints must verify a real authorized payment
// before creating any money state (parity with /api/cart/checkout gate).
// `context.listingIds` binds the intent to the items it was authorized for.
// Returns { ok:true, pi } or sends 400 and returns { ok:false }.
async function gateLegacyPayment(req, res, context = {}) {
  const { paymentIntentId } = req.body || {};
  if (!paymentIntentId) {
    res.status(400).json({ message: 'A confirmed paymentIntentId is required for purchase.' });
    return { ok: false };
  }
  let pi;
  try {
    pi = await findPaymentIntent(paymentIntentId);
  } catch (e) {
    res.status(400).json({ message: 'Payment intent could not be verified' });
    return { ok: false };
  }
  if (!pi || !['requires_capture', 'succeeded'].includes(pi.status)) {
    res.status(400).json({ message: `Payment not authorized. Status: ${pi?.status || 'unknown'}` });
    return { ok: false };
  }
  // TDD-B1: the intent must have been authorized for THIS buyer and THESE
  // items — otherwise a $5 authorization could be redeemed for a $500 item,
  // or another account could spend an intent it never authorized.
  const binding = verifyIntentBinding(pi, {
    buyerId: req.user ? req.user._id : undefined, // guests have no identity to compare
    listingIds: context.listingIds,
  });
  if (!binding.ok) {
    res.status(400).json({ message: binding.reason });
    return { ok: false };
  }
  // TDD-B1: a single authorized intent must fund exactly ONE purchase. Without
  // this, the same authorized id could be replayed against every listing the
  // buyer wants for free (the legacy paths create no Payout to deduplicate on).
  const alreadyUsed = await Transaction.findOne({
    'paymentBreakdown.paymentIntentId': pi.id,
  }).select('_id');
  if (alreadyUsed) {
    res.status(400).json({ message: 'This payment has already been used for another purchase.' });
    return { ok: false };
  }
  return { ok: true, pi };
}

// TDD-B4: accepted offers expire 24h after acceptance (acceptedUntil).
// Returns { offer, finalPrice } or sends 400 { ok:false }.
async function resolveAcceptedOfferForPurchase(listingId, buyerId, res) {
  const offer = await Offer.findOne({ listing: listingId, buyer: buyerId, status: 'accepted' });
  if (!offer) return { offer: null, finalPrice: null };
  if (offer.acceptedUntil && new Date(offer.acceptedUntil).getTime() < Date.now()) {
    offer.status = 'expired';
    try { await offer.save(); } catch (e) {}
    res.status(400).json({ message: 'Accepted offer has expired. Please make a new offer.' });
    return { ok: false };
  }
  // acceptedPrice is authoritative (set at accept time); fall back for legacy docs.
  const finalPrice = offer.acceptedPrice ?? offer.counterAmount ?? offer.amount;
  return { offer, finalPrice };
}

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

    // TDD-B1: guest checkout must also present a verified authorized payment
    // (validated before any inventory/seller-state mutation).
    const gate = await gateLegacyPayment(req, res, { listingIds: [listingId] });
    if (!gate.ok) return;

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
        // TDD-B1: record the funding intent so a single authorization can
        // never be replayed for a second purchase (and so confirm-batch
        // dedupe sees guest purchases).
        paymentIntentId: gate.pi.id,
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
    // Declared outside try so the catch can compensate a partially-built
    // purchase (the tracker is populated once the payment gate passes).
    const rollback = createPurchaseRollback();
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

      // TDD-B4: accepted offer price = acceptedPrice (authoritative); expired offers rejected.
      // Also link the offer to the transaction for tracking.
      const resolved = await resolveAcceptedOfferForPurchase(listingId, req.user._id, res);
      if (resolved.ok === false) return;
      const existingOffer = resolved.offer;
      const finalPrice = existingOffer ? resolved.finalPrice : listing.price;
      const isNegotiated = !!existingOffer;
      const negotiatedPrice = isNegotiated ? resolved.finalPrice : null;

      // TDD-B1: verify authorized payment BEFORE any money/inventory state.
      const gate = await gateLegacyPayment(req, res, { listingIds: [listingId] });
      if (!gate.ok) return;

      // Compensating-transaction tracker: everything this purchase creates is
      // recorded so a failure at ANY later step can be undone completely.
      rollback.track.setIntent(gate.pi.id);

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
        paymentIntentId: gate.pi.id,
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
    rollback.track.addTransaction(transaction._id, gate.pi.id);

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
      await rollback.run();
      return res.status(400).json({ message: 'Sorry, this item just went out of stock' });
    }
    rollback.track.addInventory(listingId, 1);

    // Item-level boost fee ledger (this listing only)
    await recordBoostFeeOwed(listing._id, boostFee, 1);
    rollback.track.addBoostFee(listing._id, boostFee);

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
      // Only revertible once persisted — a rolled-back purchase leaves the
      // seller with no phantom pending earnings.
      rollback.track.addSellerCredit(seller._id, finalSellerEarnings);
    }

    // CRITICAL FIX: Every purchase MUST create a consolidated Enterprise Order
    // (same shape as confirm-batch) so buyers/sellers can manage, ship,
    // confirm-received, and return items via /api/orders across platforms.
    try {
      await Order.create({
        buyer: req.user._id,
        sellers: [listing.seller],
        currency: transaction.currency || 'USD',
        items: [{
          listing: listing._id,
          transaction: transaction._id,
          seller: listing.seller,
          title: listing.title || '',
          price: transaction.itemPrice || 0,
          quantity: 1,
          currency: transaction.currency || 'USD',
          image: (listing.images && listing.images[0]) || '',
          condition: listing.condition || '',
          size: listing.size || '',
          brand: listing.brand || '',
        }],
        shipments: [{
          seller: listing.seller,
          items: [transaction._id],
          shippingCost: transaction.paymentBreakdown?.shippingCost || 0,
          currency: transaction.currency || 'USD',
          labelStatus: 'created',
          status: 'pending',
        }],
        totals: {
          subtotal: transaction.paymentBreakdown?.subtotal || transaction.itemPrice || 0,
          shipping: transaction.paymentBreakdown?.shippingCost || 0,
          protectionFees: transaction.paymentBreakdown?.buyerProtectionFee || 0,
          discounts: 0,
          total: transaction.paymentBreakdown?.totalPaid || 0,
        },
        payment: {
          paymentIntentId: transaction.paymentBreakdown?.paymentIntentId || '',
          status: 'captured',
          currency: transaction.currency || 'USD',
          totalHeld: transaction.paymentBreakdown?.totalPaid || 0,
        },
        shippingAddress: {
          fullName: shippingAddress?.fullName || req.user.name,
          street1: shippingAddress?.street1 || '',
          street2: shippingAddress?.street2 || '',
          city: shippingAddress?.city || '',
          state: shippingAddress?.state || '',
          postalCode: shippingAddress?.postalCode || '',
          country: shippingAddress?.country || req.user.country || 'US',
          phone: shippingAddress?.phone || '',
        },
      });
    } catch (orderErr) {
      // Order is a grouping convenience; the money flow must not roll back.
      console.error('Order creation failed (transaction still committed):', orderErr.message);
    }

    await transaction.populate(['buyer', 'seller', 'listing']);
    res.status(201).json(transaction);
  } catch (error) {
    console.error(error);
    // Money-only-upon-success: a purchase that failed part-way through must
    // leave no transaction, no depleted inventory, no seller credit and no
    // live payment hold behind.
    await rollback.run();
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/transactions/offer/:offerId - Create a transaction based on an accepted offer (buyer has accepted seller's counter)
router.post('/offer/:offerId', auth, async (req, res) => {
  // Declared outside try so the catch can compensate a partially-built
  // purchase (the tracker is populated once the payment gate passes).
  const rollback = createPurchaseRollback();
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
    // TDD-B4: acceptedUntil expiry enforced; acceptedPrice authoritative.
    if (offer.acceptedUntil && new Date(offer.acceptedUntil).getTime() < Date.now()) {
      offer.status = 'expired';
      try { await offer.save(); } catch (e) {}
      return res.status(400).json({ message: 'Accepted offer has expired. Please make a new offer.' });
    }
    // Use the agreed price: acceptedPrice authoritative, legacy fallback.
    const finalPrice = offer.acceptedPrice ?? offer.counterAmount ?? offer.amount;

    const listing = await Listing.findById(offer.listing);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (!listing.available || listing.sold || (listing.quantity !== undefined && listing.quantity <= 0)) {
      return res.status(400).json({ message: 'Listing not available for purchase' });
    }
    // TDD-B1: verify authorized payment BEFORE any money/inventory state.
    const offerGate = await gateLegacyPayment(req, res, { listingIds: [offer.listing] });
    if (!offerGate.ok) return;

    // Compensating-transaction tracker: everything this purchase creates is
    // recorded so a failure at ANY later step can be undone completely.
    rollback.track.setIntent(offerGate.pi.id).restoreOffer(offer._id, 'accepted');

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
        // TDD-B1: funding intent recorded so it cannot be replayed.
        paymentIntentId: offerGate.pi.id,
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
    rollback.track.addTransaction(transaction._id, offerGate.pi.id);

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
      await rollback.run();
      return res.status(400).json({ message: 'Sorry, this item just went out of stock' });
    }
    rollback.track.addInventory(listing._id, 1);

    // Item-level boost fee ledger (this listing only)
    await recordBoostFeeOwed(listing._id, boostFee, 1);
    rollback.track.addBoostFee(listing._id, boostFee);

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
      // Only revertible once persisted — a rolled-back purchase leaves the
      // seller with no phantom pending earnings.
      rollback.track.addSellerCredit(seller._id, breakdown.seller.sellerEarnings - boostFee);
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
    // Money-only-upon-success: a failed offer purchase must leave no
    // transaction, no depleted inventory, no seller credit, no live payment
    // hold — and the accepted offer must remain usable.
    await rollback.run();
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/transactions - Get user's transactions (paginated + status filter)
// Query params:
//   type: 'all' | 'bought' | 'sold'  (default: 'all')
//   status: single status or comma-separated list (e.g. 'paid,processing')
//   page: page number (default: 1)
//   limit: items per page (default: 20, max: 100)
//
// Default status filters applied when no explicit status is provided:
//   sold   -> ['paid', 'processing']              (sold & ready to ship)
//   bought -> ['paid', 'processing', 'shipped', 'in_transit']  (active orders)
//   all    -> no status filter
router.get('/', auth, async (req, res) => {
  try {
    const { type = 'all', status } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const rawLimit = parseInt(req.query.limit);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 100);

    // Build base query by role
    let query = {};
    if (type === 'bought') {
      query.buyer = req.user._id;
    } else if (type === 'sold') {
      query.seller = req.user._id;
    } else {
      query.$or = [{ buyer: req.user._id }, { seller: req.user._id }];
    }

    // Build status filter
    if (status) {
      // Explicit status filter from client
      const statusList = status.split(',').map(s => s.trim()).filter(Boolean);
      query.status = { $in: statusList };
    } else {
      // Apply default status filter based on type
      if (type === 'sold') {
        // Default: sold items that are paid/processing (ready to ship)
        query.status = { $in: ['paid', 'processing'] };
      } else if (type === 'bought') {
        // Default: active bought items (in progress)
        query.status = { $in: ['paid', 'processing', 'shipped', 'in_transit'] };
      }
      // type === 'all' -> no status filter (show everything)
    }

    // Execute paginated query
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .populate('buyer', 'name avatar country')
        .populate('seller', 'name avatar country')
        .populate('listing', 'title images price currency category brand')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      transactions,
      pagination: {
        total,
        totalPages,
        currentPage: page,
        limit,
        hasMore: page < totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
      },
    });
  } catch (error) {
    console.error('GET /transactions error:', error);
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