const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const {
  stripe,
  countryCommissions,
  calculatePaymentBreakdown,
  authorizePaymentIntent,   // Auth only - no charge
  capturePaymentIntent,     // Capture after fulfillment
  retrievePaymentIntent,
  releaseAuthorization,     // Release auth if fulfillment fails
  verifyStripeWebhook,
  processSellerPayout,
  issueRefund,
} = require('../config/payments');

// ===================== PUBLIC ENDPOINTS =====================

router.get('/publishable-key', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder' });
});

router.get('/commissions', (req, res) => res.json(countryCommissions));

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

// ===================== AUTHENTICATED ENDPOINTS =====================

// STEP 1: Authorize payment only (NO CHARGE)
// capture_method: manual means Stripe holds authorization but doesn't capture funds
router.post('/create-intent', auth, async (req, res) => {
  try {
    const { listingId, shippingAddress, buyerCountry } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.seller.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot purchase your own listing' });
    }
    if (!listing.available || listing.sold || listing.quantity <= 0) {
      return res.status(400).json({ message: 'Item is no longer available' });
    }

    const seller = await User.findById(listing.seller);
    const sellerCountry = seller?.country || listing.shipsFrom || 'US';
    const toCountry = buyerCountry || req.user.country || 'US';

    const breakdown = calculatePaymentBreakdown(listing.price, sellerCountry, toCountry, listing.weight || 0.5);

    // Authorize ONLY - no money moves yet
    const paymentIntent = await authorizePaymentIntent(
      breakdown.buyer.totalPaid,
      breakdown.buyerCurrency,
      {
        listingId: listing._id.toString(),
        buyerId: req.user._id.toString(),
        sellerId: listing.seller.toString(),
        sellerCountry,
        buyerCountry: toCountry,
        platformFee: breakdown.seller.platformFee.toString(),
        sellerEarnings: breakdown.seller.sellerEarnings.toString(),
      }
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: breakdown.buyer.totalPaid,
      currency: breakdown.buyerCurrency,
      breakdown,
      status: paymentIntent.status, // 'requires_payment_method' → 'requires_capture'
    });
  } catch (error) {
    console.error('Create intent error:', error);
    res.status(500).json({ message: error.message || 'Error creating payment intent' });
  }
});

// STEP 2 (Batch): Fulfill batch orders then capture payment
router.post('/confirm-batch', auth, async (req, res) => {
  const transactions = [];
  let captured = false;

  try {
    const { paymentIntentId, items, shippingAddress } = req.body;
    if (!paymentIntentId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Missing paymentIntentId or items' });
    }

    // Verify authorization status from Stripe
    const paymentIntent = await retrievePaymentIntent(paymentIntentId);
    if (paymentIntent.status !== 'requires_capture') {
      return res.status(400).json({
        message: `Payment not authorized. Status: ${paymentIntent.status}`,
      });
    }

    // Deduplicate - check if already processed
    const existingPayout = await Payout.findOne({ 'paymentIntentId': paymentIntentId });
    if (existingPayout) {
      return res.json({ message: 'Order already processed', transactions: [] });
    }

    for (const item of items) {
      const listing = await Listing.findById(item.listingId);
      if (!listing || !listing.available || listing.sold || listing.quantity <= 0) {
        continue; // Skip unavailable items
      }

      const seller = await User.findById(listing.seller);
      const sellerCountry = seller?.country || listing.shipsFrom || 'US';
      const toCountry = shippingAddress?.country || req.user.country || 'US';

      // Use negotiated price if available, otherwise listing price
      const salePrice = item.negotiatedPrice || listing.price;
      const breakdown = calculatePaymentBreakdown(salePrice, sellerCountry, toCountry, listing.weight || 0.5);

      // Generate shipping label
      const { generateLabel, getPreferredCarrier } = require('../config/shipping');
      const sellerAddress = seller?.shippingAddress ? {
        street1: seller.shippingAddress.street1,
        city: seller.shippingAddress.city,
        state: seller.shippingAddress.state,
        postalCode: seller.shippingAddress.postalCode,
        country: seller.shippingAddress.country || sellerCountry,
      } : { country: sellerCountry };

      const carrierCode = getPreferredCarrier(toCountry, sellerCountry === toCountry);
      const label = generateLabel({
        shippingAddress: { fullName: shippingAddress?.fullName || req.user.name, ...shippingAddress },
        sellerAddress,
        weight: listing.weight || 0.5,
      }, carrierCode);

      const txn = await Transaction.create({
        listing: listing._id,
        buyer: req.user._id,
        seller: listing.seller,
        itemPrice: salePrice,
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
        shipping: {
          carrier: label.carrier,
          trackingNumber: label.trackingNumber,
          trackingUrl: label.trackingUrl,
          labelCreated: true,
          labelCreatedDate: new Date(),
          estimatedDelivery: new Date(label.estimatedDelivery),
          service: label.service,
          trackingHistory: label.statusHistory,
        },
        status: 'shipped',
        payout: { status: 'pending', transactionId: paymentIntentId },
        autoTracking: { enabled: true, lastChecked: new Date(), nextCheck: new Date(Date.now() + 86400000), attempts: 0 },
      });

      transactions.push(txn);

      // Update inventory
      const wasLastOne = listing.quantity === 1;
      await Listing.findOneAndUpdate(
        { _id: listing._id, quantity: { $gt: 0 } },
        { $inc: { quantity: -1, quantitySold: 1 }, $set: wasLastOne ? { sold: true, available: false } : {} },
        { new: true }
      );

      // Update seller balance
      if (seller) {
        seller.balance.pending = (seller.balance.pending || 0) + breakdown.seller.sellerEarnings;
        seller.notifications.unshift({
          type: 'sale',
          from: req.user._id,
          listing: listing._id,
          transaction: txn._id,
          message: `Item sold! You'll earn ${breakdown.seller.sellerEarnings} ${breakdown.sellerCurrency}.`,
        });
        await seller.save();
      }

      // Create payout record
      try {
        await Payout.create({
          seller: listing.seller,
          transaction: txn._id,
          listing: listing._id,
          salePrice: breakdown.buyer.itemPrice,
          commissionRate: breakdown.seller.platformFeePercent / 100,
          commissionAmount: breakdown.seller.platformFee,
          payoutAmount: breakdown.seller.sellerEarnings,
          status: 'pending',
        });
      } catch (pErr) {
        console.error('Auto-payout creation error:', pErr.message);
      }
    }

    // Capture payment
    const captureResult = await capturePaymentIntent(paymentIntentId);
    captured = true;

    // Populate all transactions
    for (const txn of transactions) {
      await txn.populate(['buyer', 'seller', 'listing']);
    }

    res.json({
      transactions,
      captureResult: { id: captureResult.id, status: captureResult.status },
    });

  } catch (error) {
    console.error('Confirm batch payment error:', error);
    if (!captured && req.body.paymentIntentId) {
      try { await releaseAuthorization(req.body.paymentIntentId); } catch (e) {}
    }
    if (captured && req.body.paymentIntentId) {
      try { await issueRefund(req.body.paymentIntentId); } catch (e) {}
    }
    // Cleanup partial transactions
    for (const txn of transactions) {
      if (!captured) {
        try { await Transaction.findByIdAndDelete(txn._id); } catch (e) {}
      }
    }
    res.status(500).json({ message: error.message || 'Error confirming batch payment' });
  }
});

// STEP 2: Fulfill order then capture payment (single item)
// 1. Verify authorization succeeded
// 2. Generate shipping label
// 3. Create transaction record
// 4. Capture the payment (money moves now)
// 5. Update inventory + seller stats
router.post('/confirm', auth, async (req, res) => {
  let createdTransaction = null;
  let captured = false;

  try {
    const { paymentIntentId, listingId, shippingAddress } = req.body;

    if (!paymentIntentId) return res.status(400).json({ message: 'Missing paymentIntentId' });

    // Verify authorization status from Stripe
    const paymentIntent = await retrievePaymentIntent(paymentIntentId);
    if (paymentIntent.status !== 'requires_capture') {
      return res.status(400).json({
        message: `Payment not authorized. Status: ${paymentIntent.status}. Expected: requires_capture`,
      });
    }

    // Deduplicate - check if already processed
    const existingTxn = await Transaction.findOne({ 'payout.transactionId': paymentIntentId });
    if (existingTxn) {
      return res.json({ message: 'Order already exists for this payment', transaction: existingTxn });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      await releaseAuthorization(paymentIntentId);
      return res.status(404).json({ message: 'Listing not found. Authorization released.' });
    }
    if (!listing.available || listing.sold || listing.quantity <= 0) {
      await releaseAuthorization(paymentIntentId);
      return res.status(400).json({ message: 'Item sold out. Authorization released.' });
    }

    const seller = await User.findById(listing.seller);
    const sellerCountry = seller?.country || listing.shipsFrom || 'US';
    const toCountry = shippingAddress?.country || req.user.country || 'US';
    const breakdown = calculatePaymentBreakdown(listing.price, sellerCountry, toCountry, listing.weight || 0.5);

    // ---------- FULFILLMENT (Label Generation) ----------
    // Generate shipping label BEFORE capturing payment
    const { generateLabel, getPreferredCarrier } = require('../config/shipping');
    const sellerAddress = seller?.shippingAddress ? {
      street1: seller.shippingAddress.street1,
      city: seller.shippingAddress.city,
      state: seller.shippingAddress.state,
      postalCode: seller.shippingAddress.postalCode,
      country: seller.shippingAddress.country || sellerCountry,
    } : { country: sellerCountry };

    const carrierCode = getPreferredCarrier(toCountry, sellerCountry === toCountry);
    const label = generateLabel({
      shippingAddress: {
        fullName: shippingAddress?.fullName || req.user.name,
        ...shippingAddress,
      },
      sellerAddress,
      weight: listing.weight || 0.5,
    }, carrierCode);

    // ---------- CREATE TRANSACTION ----------
    createdTransaction = await Transaction.create({
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
      shipping: {
        carrier: label.carrier,
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl,
        labelCreated: true,
        labelCreatedDate: new Date(),
        estimatedDelivery: new Date(label.estimatedDelivery),
        service: label.service,
        trackingHistory: label.statusHistory,
      },
      status: 'shipped',
      payout: {
        status: 'pending',
        transactionId: paymentIntentId,
      },
      autoTracking: {
        enabled: true,
        lastChecked: new Date(),
        nextCheck: new Date(Date.now() + 86400000),
        attempts: 0,
      },
    });

    // ---------- NOW CAPTURE PAYMENT (money moves) ----------
    const captureResult = await capturePaymentIntent(paymentIntentId);
    captured = true;

    // ---------- UPDATE INVENTORY (only after capture success) ----------
    const wasLastOne = listing.quantity === 1;
    const inventoryUpdate = await Listing.findOneAndUpdate(
      { _id: listingId, quantity: { $gt: 0 } },
      {
        $inc: { quantity: -1, quantitySold: 1 },
        $set: wasLastOne ? { sold: true, available: false } : {},
      },
      { new: true }
    );

    if (!inventoryUpdate) {
      // Extremely rare: someone bought between our check and capture
      // Money is captured - issue refund
      await issueRefund(paymentIntentId);
      createdTransaction.status = 'refunded';
      createdTransaction.payout.status = 'refunded';
      await createdTransaction.save();
      return res.status(400).json({ message: 'Item sold out between authorization and capture. Full refund issued.' });
    }

    // ---------- UPDATE SELLER BALANCE (pending until order completes) ----------
    if (seller) {
      seller.balance.pending = (seller.balance.pending || 0) + breakdown.seller.sellerEarnings;
      // NOTE: totalSales is incremented in orderLifecycle.js when order auto-completes
      seller.notifications.unshift({
        type: 'sale',
        from: req.user._id,
        listing: listing._id,
        transaction: createdTransaction._id,
        message: `Item sold! You'll earn ${breakdown.seller.sellerEarnings} ${breakdown.sellerCurrency}. Shipping label ready.`,
      });
      await seller.save();
    }

    // NOTE: totalPurchases is incremented in orderLifecycle.js when order auto-completes

    // ---------- AUTO-CREATE PAYOUT RECORD ----------
    // CRITICAL: Use actual breakdown values, NOT recalculated from totalPaid
    // salePrice = item price only (shipping + buyer protection are pass-through fees)
    try {
      const existingPayout = await Payout.findOne({ transaction: createdTransaction._id });
      if (!existingPayout) {
        const itemPrice = breakdown.buyer.itemPrice || listing.price || 0;
        const commissionAmount = breakdown.seller.platformFee;
        const payoutAmount = breakdown.seller.sellerEarnings;
        await Payout.create({
          seller: listing.seller,
          transaction: createdTransaction._id,
          listing: listingId,
          salePrice: itemPrice,
          commissionRate: breakdown.seller.platformFeePercent / 100,
          commissionAmount,
          payoutAmount,
          status: 'pending',
        });
      }
    } catch (pErr) {
      console.error('Auto-payout creation error:', pErr.message);
    }

    await createdTransaction.populate(['buyer', 'seller', 'listing']);
    res.json({
      transaction: createdTransaction,
      breakdown,
      captureResult: { id: captureResult.id, status: captureResult.status },
      shipping: {
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl,
        carrier: label.carrier,
      },
    });

  } catch (error) {
    console.error('Confirm payment error:', error);

    // Rollback: Release authorization if we never captured
    if (!captured && req.body.paymentIntentId) {
      try { await releaseAuthorization(req.body.paymentIntentId); } catch (e) {}
    }

    // Rollback: If we captured but something else failed, issue refund
    if (captured && req.body.paymentIntentId) {
      try { await issueRefund(req.body.paymentIntentId); } catch (e) {}
    }

    // Rollback: Delete partial transaction if created
    if (createdTransaction && !captured) {
      try { await Transaction.findByIdAndDelete(createdTransaction._id); } catch (e) {}
    }

    res.status(500).json({ message: error.message || 'Error confirming payment' });
  }
});

// POST /api/payments/cancel-payment - Release authorization if order not completed
router.post('/cancel-payment', auth, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const result = await releaseAuthorization(paymentIntentId);
    res.json({ message: 'Authorization released. No charge was made.', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || 'Error cancelling payment' });
  }
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
    user.balance.totalPaidOut = (user.balance.totalPaidOut || 0) + amount;
    user.balance.available = 0;
    await user.save();
    res.json({ payout, message: `Payout of ${amount} ${user.balance.currency} processed` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || 'Error processing payout' });
  }
});

module.exports = router;