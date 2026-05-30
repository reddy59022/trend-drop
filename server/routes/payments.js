const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { countryCommissions, stripeFees, calculatePaymentBreakdown, createStripePaymentIntent, verifyStripeWebhook, processSellerPayout } = require('../config/payments');

// POST /api/payments/create-intent - Create Stripe Payment Intent
router.post('/create-intent', auth, async (req, res) => {
  try {
    const { listingId, shippingAddress, buyerCountry } = req.body;

    const Listing = require('../models/Listing');
    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.sold) return res.status(400).json({ message: 'Item already sold' });

    const seller = await User.findById(listing.seller);
    const sellerCountry = seller?.country || listing.shipsFrom || 'US';
    const toCountry = buyerCountry || req.user.country || 'US';

    // Calculate full breakdown with country-specific fees
    const breakdown = calculatePaymentBreakdown(listing.price, sellerCountry, toCountry, listing.weight || 0.5);

    // Create Stripe payment intent
    const paymentIntent = await createStripePaymentIntent(
      breakdown.buyer.totalPaid,
      breakdown.buyerCurrency,
      {
        listingId: listing._id.toString(),
        buyerId: req.user._id.toString(),
        sellerId: listing.seller.toString(),
        sellerCountry,
        buyerCountry: toCountry,
      }
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: breakdown.buyer.totalPaid,
      currency: breakdown.buyerCurrency,
      breakdown,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating payment intent' });
  }
});

// POST /api/payments/confirm - Confirm payment after Stripe success
router.post('/confirm', auth, async (req, res) => {
  try {
    const { paymentIntentId, listingId, shippingAddress } = req.body;

    const Listing = require('../models/Listing');
    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    const seller = await User.findById(listing.seller);
    const sellerCountry = seller?.country || listing.shipsFrom || 'US';
    const toCountry = shippingAddress?.country || req.user.country || 'US';
    const breakdown = calculatePaymentBreakdown(listing.price, sellerCountry, toCountry, listing.weight || 0.5);

    // Create transaction with full breakdown
    const transaction = await Transaction.create({
      listing: listingId,
      buyer: req.user._id,
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
        sellerEarnings: breakdown.seller.sellerEarnings,
      },
      shippingAddress: {
        fullName: shippingAddress?.fullName || req.user.name,
        street1: shippingAddress?.street1,
        street2: shippingAddress?.street2,
        city: shippingAddress?.city,
        state: shippingAddress?.state,
        postalCode: shippingAddress?.postalCode,
        country: toCountry,
        phone: shippingAddress?.phone,
      },
      status: 'paid',
      payout: { status: 'pending' },
      autoTracking: { enabled: true, lastChecked: new Date(), nextCheck: new Date(Date.now() + 86400000), attempts: 0 },
    });

  // Update inventory based on quantity
  // Decrement available quantity (assume each purchase is quantity 1)
  if (typeof listing.quantity === 'number') {
    listing.quantity = Math.max(0, listing.quantity - 1);
    listing.quantitySold = (listing.quantitySold || 0) + 1;
    // If no more items left, mark as sold and unavailable
    if (listing.quantity <= 0) {
      listing.sold = true;
      listing.available = false;
    }
  }
  await listing.save();

    // Credit seller pending balance
    if (seller) {
      seller.balance.pending += breakdown.seller.sellerEarnings;
      seller.notifications.unshift({
        type: 'sale',
        from: req.user._id,
        listing: listing._id,
        transaction: transaction._id,
        message: `Item sold! You'll earn ${breakdown.seller.sellerEarnings} ${breakdown.sellerCurrency}.`,
      });
      await seller.save();
    }

    await transaction.populate(['buyer', 'seller', 'listing']);
    res.json({ transaction, breakdown });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error confirming payment' });
  }
});

// POST /api/payments/webhook - Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const event = verifyStripeWebhook(req.body, sig);

    switch (event.type) {
      case 'payment_intent.succeeded':
        // Payment succeeded - confirm transaction
        break;
      case 'payment_intent.payment_failed':
        // Payment failed - notify buyer
        break;
      case 'charge.refunded':
        // Refund processed
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ message: 'Webhook error' });
  }
});

// GET /api/payments/breakdown - Calculate payment breakdown
router.post('/breakdown', (req, res) => {
  try {
    const { itemPrice, fromCountry, toCountry, weightKg } = req.body;
    const breakdown = calculatePaymentBreakdown(itemPrice || 0, fromCountry || 'US', toCountry || 'US', weightKg || 0.5);
    res.json(breakdown);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error calculating breakdown' });
  }
});

// GET /api/payments/commissions - Get all country commissions
router.get('/commissions', (req, res) => {
  res.json(countryCommissions);
});

// POST /api/payments/payout - Process seller payout
router.post('/payout', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.balance || user.balance.available <= 0) {
      return res.status(400).json({ message: 'No available balance for payout' });
    }
    if (!user.payoutMethod || !user.payoutMethod.type) {
      return res.status(400).json({ message: 'Please set up a payout method first' });
    }

    const amount = user.balance.available;
    const payout = await processSellerPayout(user._id, amount, user.balance.currency || 'USD', user.payoutMethod.type);

    user.balance.totalPaidOut += amount;
    user.balance.available = 0;
    await user.save();

    res.json({ payout, message: `Payout of ${amount} ${user.balance.currency} processed` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error processing payout' });
  }
});

// RevenueCat endpoints for mobile
// NOTE: RevenueCat validation endpoint removed. Payments are now handled solely via Stripe.

// GET /api/payments/platform-fee - Get platform fee info
router.get('/platform-fee', (req, res) => {
  const { country } = req.query;
  const fee = countryCommissions[country] || countryCommissions.default;
  res.json({
    country: country || 'default',
    platformFeePercent: fee.platformFee,
    buyerProtectionPercent: fee.buyerProtection,
    minFee: fee.minFee,
    maxFee: fee.maxFee,
    currency: fee.currency,
  });
});

module.exports = router;