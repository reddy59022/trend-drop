const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Offer = require('../models/Offer');
const Promo = require('../models/Promo');
const BundleRule = require('../models/BundleRule');
const Order = require('../models/Order');
const {
  stripe,
  countryCommissions,
  calculatePaymentBreakdown,
  authorizePaymentIntent,
  capturePaymentIntent,
  retrievePaymentIntent,
  releaseAuthorization,
  verifyStripeWebhook,
  processSellerPayout,
  issueRefund,
  fetchExchangeRate,
} = require('../config/payments');
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
// Boost fees always stay with the listing that generated them.
// Reversed only via orderLifecycle cancel/refund/return.
const recordBoostFeeOwed = async (listingId, boostFee, saleQuantity = 1) => {
  if (!boostFee || boostFee <= 0) return null;
  const totalFee = Math.round(boostFee * saleQuantity * 100) / 100;
  return Listing.findByIdAndUpdate(
    listingId,
    { $inc: { 'boost.feeLedger.owed': totalFee } },
    { new: true }
  );
};

// ===================== PUBLIC ENDPOINTS =====================

router.get('/publishable-key', (req, res) => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  res.json({ 
    publishableKey: key || 'pk_test_placeholder',
    configured: !!(key && key.startsWith('pk_')),
  });
});

// Debug endpoint to check payment system status
router.get('/status', (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  
  res.json({
    stripe: {
      publishableKeyConfigured: !!(publishableKey && publishableKey.startsWith('pk_')),
      secretKeyConfigured: !!(secretKey && secretKey.startsWith('sk_')),
      stripeInitialized: !!stripe,
    },
    environment: process.env.NODE_ENV || 'development',
  });
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

// STEP 1: Authorize payment for batch/multi-item checkout (NO CHARGE)
// Supports multiple items from potentially different sellers
// Applies promo codes and bundle discounts
router.post('/create-intent', auth, async (req, res) => {
  try {
    const { items, shippingAddress, buyerCountry, promoCode } = req.body;
    
    // Support both single listingId and batch items array
    let itemsArray = items;
    if (!itemsArray && req.body.listingId) {
      // Legacy single-item support
      itemsArray = [{ listingId: req.body.listingId, quantity: 1 }];
    }
    
    if (!itemsArray || !Array.isArray(itemsArray) || itemsArray.length === 0) {
      return res.status(400).json({ message: 'No items provided' });
    }

    // Validate all items and calculate total
    let totalAmount = 0;
    const breakdowns = [];
    const itemData = [];
    let promoDiscount = 0;
    let appliedPromo = null;

    for (const item of itemsArray) {
      const listing = await Listing.findById(item.listingId);
      if (!listing) return res.status(404).json({ message: `Listing ${item.listingId} not found` });
      if (listing.seller.toString() === req.user._id.toString()) {
        return res.status(400).json({ message: 'Cannot purchase your own listing' });
      }
      if (!listing.available || listing.sold || listing.quantity <= 0) {
        return res.status(400).json({ message: `"${listing.title}" is no longer available` });
      }
      if (listing.quantity < (item.quantity || 1)) {
        return res.status(400).json({ message: `Only ${listing.quantity} left of "${listing.title}"` });
      }

      const seller = await User.findById(listing.seller);
      const sellerCountry = seller?.country || listing.shipsFrom || 'US';
      const toCountry = buyerCountry || shippingAddress?.country || req.user.country || 'US';

      // Determine price (offer price or listing price)
      let salePrice = listing.price;
      let isNegotiated = false;
      if (item.offerId) {
        const offer = await Offer.findById(item.offerId);
        if (offer && offer.status === 'accepted' && offer.buyer.toString() === req.user._id.toString()) {
          salePrice = offer.acceptedPrice || offer.counterAmount || offer.amount;
          isNegotiated = true;
        }
      } else if (item.negotiatedPrice) {
        salePrice = item.negotiatedPrice;
        isNegotiated = true;
      }

      const buyerCurrency = (countryCommissions[toCountry] || countryCommissions.default).currency;
      const exchangeRate = await fetchExchangeRate(buyerCurrency);
      const qty = Math.max(1, Math.floor(item.quantity || 1));
      // ZERO-LEAKAGE PARITY: authorize EXACTLY what confirm-batch will record.
      // One label per listing quantity → shipping on COMBINED weight;
      // item subtotal + buyer protection scale linearly with qty.
      const combinedWeight = Math.round(((listing.weight || 0.5) * qty) * 1000) / 1000;
      const breakdown = calculatePaymentBreakdown(salePrice, sellerCountry, toCountry, combinedWeight, exchangeRate);
      const itemSubtotal = Math.round(salePrice * qty * 100) / 100;
      const shippingCostTotal = Math.round(breakdown.buyer.shippingCost * 100) / 100;
      const protectionTotal = Math.round(breakdown.buyer.buyerProtectionFee * qty * 100) / 100;
      const lineTotal = Math.round((itemSubtotal + shippingCostTotal + protectionTotal) * 100) / 100;

      totalAmount += lineTotal;
      breakdowns.push(breakdown);
      itemData.push({
        listing, seller, sellerCountry, toCountry, salePrice, breakdown,
        isNegotiated, exchangeRate, quantity: qty
      });
    }

    // ===== Promo Code Application =====
    if (promoCode) {
      const promo = await Promo.findOne({
        code: promoCode.toUpperCase(),
        seller: { $in: itemData.map(d => d.listing.seller) },
        isActive: true,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } },
        ],
      });
      if (promo) {
        if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
          return res.status(400).json({ message: 'Promo code usage limit reached' });
        }
        if (totalAmount < (promo.minPurchaseAmount || 0)) {
          return res.status(400).json({ message: `Minimum purchase amount $${promo.minPurchaseAmount} not met` });
        }
        if (promo.discountType === 'percentage') {
          promoDiscount = Math.round(totalAmount * (promo.discountValue / 100) * 100) / 100;
        } else {
          promoDiscount = Math.min(promo.discountValue, totalAmount);
        }
        promoDiscount = Math.round(promoDiscount * 100) / 100;
        appliedPromo = promo;
      }
    }

    // Apply promo discount to total
    if (promoDiscount > 0) {
      totalAmount = Math.max(0, Math.round((totalAmount - promoDiscount) * 100) / 100);
    }

    // ===== Bundle Discount Application =====
    let bundleDiscountTotal = 0;
    const sellerGroups = {};
    itemData.forEach(d => {
      const sellerKey = d.seller._id.toString();
      if (!sellerGroups[sellerKey]) sellerGroups[sellerKey] = { items: [], seller: d.seller };
      sellerGroups[sellerKey].items.push(d);
    });

    for (const key of Object.keys(sellerGroups)) {
      const group = sellerGroups[key];
      const bundleRules = await BundleRule.find({ seller: group.seller._id, isActive: true });
      for (const rule of bundleRules) {
        let eligibleItems = group.items;
        if (rule.applicableCategories && rule.applicableCategories.length > 0) {
          eligibleItems = group.items.filter(d => rule.applicableCategories.includes(d.listing.category));
        }
        if (eligibleItems.length >= rule.minQuantity) {
          const discount = eligibleItems.reduce((sum, d) => sum + d.salePrice, 0) * (rule.discountPercent / 100);
          bundleDiscountTotal += Math.round(discount * 100) / 100;
        }
      }
    }

    if (bundleDiscountTotal > 0) {
      totalAmount = Math.max(0, Math.round((totalAmount - bundleDiscountTotal) * 100) / 100);
    }

    // Authorize payment for total amount (all items combined)
    const metadata = {
      buyerId: req.user._id.toString(),
      itemIds: itemData.map(d => d.listing._id.toString()).join(','),
      sellerIds: [...new Set(itemData.map(d => d.seller._id.toString()))].join(','),
      totalItems: itemData.length.toString(),
      appliedPromoId: appliedPromo?._id?.toString() || '',
      promoDiscount: promoDiscount.toString(),
      bundleDiscount: bundleDiscountTotal.toString(),
    };

    const paymentIntent = await authorizePaymentIntent(
      totalAmount,
      'USD',
      metadata
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalAmount,
      currency: 'USD',
      breakdowns,
      promoDiscount,
      bundleDiscount: bundleDiscountTotal,
      appliedPromo: appliedPromo ? { code: appliedPromo.code, discountAmount: promoDiscount } : null,
      status: paymentIntent.status,
      items: itemData.map(d => ({
        listingId: d.listing._id,
        title: d.listing.title,
        price: d.salePrice,
        quantity: d.quantity,
        sellerId: d.seller._id,
        sellerName: d.seller.name,
        currency: d.listing.currency || 'USD',
        thumbnail: d.listing.images?.[0] || '',
        weight: d.listing.weight || 0.5,
        sellerCountry: d.sellerCountry,
        isNegotiated: d.isNegotiated,
      })),
    });
  } catch (error) {
    console.error('Create intent error:', error);
    res.status(500).json({ message: error.message || 'Error creating payment intent' });
  }
});

// STEP 2 (Batch): Fulfill batch orders then capture payment  
// ALL-OR-NOTHING transactional checkout
// Phase 1: Validate all items + generate all labels (no DB writes)
// Phase 2: Only if ALL succeeded → create all transactions, update inventory, payouts
// Phase 3: If anything fails → full refund + no partial state
router.post('/confirm-batch', auth, async (req, res) => {
  const createdTransactions = [];
  const createdPayouts = [];
  const inventoryChanges = [];
  const sellerBalanceUpdates = [];
  let captured = false;

  try {
    const { paymentIntentId, items, shippingAddress } = req.body;
    if (!paymentIntentId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Missing paymentIntentId or items' });
    }

    // Deduplicate - check if already processed
    const existingPayout = await Payout.findOne({ paymentIntentId });
    if (existingPayout) {
      return res.json({ message: 'Order already processed', transactions: [] });
    }

    // Verify payment status from Stripe
    const paymentIntent = await retrievePaymentIntent(paymentIntentId);
    const VALID_STATUSES = ['succeeded', 'requires_capture'];
    if (!VALID_STATUSES.includes(paymentIntent.status)) {
      return res.status(400).json({
        message: `Payment not authorized. Status: ${paymentIntent.status}`,
      });
    }

    // ========== PHASE 1: Validate + Build (NO DB WRITES) ==========
    const { generateLabel, getPreferredCarrier } = require('../config/shipping');
    const orderPlans = [];

    for (const item of items) {
      const listing = await Listing.findById(item.listingId);
      if (!listing || !listing.available || listing.sold || listing.quantity <= 0) {
        return res.status(400).json({
          message: `Item ${item.listingId} is no longer available`,
          failedItem: item.listingId,
        });
      }

      // ZERO-LEAKAGE QUANTITY FIX: validate requested qty against stock
      const qty = Math.max(1, Math.floor(item.quantity || 1));
      if (listing.quantity < qty) {
        return res.status(400).json({
          message: `Only ${listing.quantity} left of "${listing.title}"`,
          failedItem: item.listingId,
        });
      }

      const seller = await User.findById(listing.seller);
      const sellerCountry = seller?.country || listing.shipsFrom || 'US';
      const toCountry = shippingAddress?.country || req.user.country || 'US';
      
      // Offer price validation
      let salePrice = listing.price;
      let offer = null;
      let isNegotiated = false;
      
      if (item.offerId) {
        offer = await Offer.findById(item.offerId);
        if (!offer) {
          return res.status(400).json({ message: `Offer ${item.offerId} not found`, failedItem: item.listingId });
        }
        if (offer.listing.toString() !== listing._id.toString()) {
          return res.status(400).json({ message: 'Offer does not belong to this listing', failedItem: item.listingId });
        }
        if (offer.buyer.toString() !== req.user._id.toString()) {
          return res.status(400).json({ message: 'Offer does not belong to this buyer', failedItem: item.listingId });
        }
        if (offer.status !== 'accepted') {
          return res.status(400).json({ message: `Offer is not accepted. Status: ${offer.status}`, failedItem: item.listingId });
        }
        salePrice = offer.acceptedPrice || offer.counterAmount || offer.amount;
        isNegotiated = true;
        if (item.negotiatedPrice && Math.abs(item.negotiatedPrice - salePrice) > 0.01) {
          return res.status(400).json({ message: `Price mismatch. Expected ${salePrice}`, failedItem: item.listingId });
        }
      } else if (item.negotiatedPrice) {
        salePrice = item.negotiatedPrice;
      }
      
      // ZERO-LEAKAGE QUANTITY FIX: one label for the whole quantity;
      // breakdown computed on the COMBINED weight so shipping is correct,
      // then platform fees scaled by qty.
      const combinedWeight = Math.round(((listing.weight || 0.5) * qty) * 1000) / 1000;
      const breakdown = calculatePaymentBreakdown(salePrice, sellerCountry, toCountry, combinedWeight);

      const itemSubtotal = Math.round(salePrice * qty * 100) / 100;
      const platformFeeTotal = Math.round(breakdown.seller.platformFee * qty * 100) / 100;
      const protectionTotal = Math.round(breakdown.buyer.buyerProtectionFee * qty * 100) / 100;
      const sellerEarningsTotal = Math.round(breakdown.seller.sellerEarnings * qty * 100) / 100;
      const shippingCostTotal = Math.round(breakdown.buyer.shippingCost * 100) / 100;
      const totalPaidTotal = Math.round((itemSubtotal + shippingCostTotal + protectionTotal) * 100) / 100;

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
        weight: combinedWeight,
      }, carrierCode);

      orderPlans.push({
        listing, seller, sellerCountry, toCountry, salePrice, breakdown, label,
        offer, isNegotiated,
        qty, itemSubtotal, platformFeeTotal, protectionTotal,
        sellerEarningsTotal, shippingCostTotal, totalPaidTotal,
      });
    }

    // ========== PHASE 2: Capture Payment ==========
    let captureResult = null;
    if (paymentIntent.status === 'requires_capture') {
      captureResult = await capturePaymentIntent(paymentIntentId);
    } else {
      captureResult = { id: paymentIntentId, status: 'succeeded' };
    }
    captured = true;

    // ========== PHASE 3: Commit all writes ==========
    for (const plan of orderPlans) {
      const { listing, seller, toCountry, salePrice, breakdown, label, offer, isNegotiated } = plan;

      // Deduct boost fee if item is boosted (flat % of sale price, scale by qty; charged only upon successful sale)
      const boostFee = Math.round(getBoostFee(listing, plan.salePrice) * plan.qty * 100) / 100;
      const sellerEarningsWithBoost = Math.round((plan.sellerEarningsTotal - boostFee) * 100) / 100;

      // Item-level boost fee ledger (this listing only)
      await recordBoostFeeOwed(listing._id, getBoostFee(listing, plan.salePrice), plan.qty);

      const txn = await Transaction.create({
        listing: listing._id,
        buyer: req.user._id,
        seller: listing.seller,
        quantity: plan.qty,
        itemPrice: plan.itemSubtotal,
        currency: listing.currency || 'USD',
        paymentBreakdown: {
          subtotal: plan.itemSubtotal,
          shippingCost: plan.shippingCostTotal,
          buyerProtectionFee: plan.protectionTotal,
          buyerProtectionPercent: breakdown.buyer.buyerProtectionPercent,
          tax: 0,
          totalPaid: plan.totalPaidTotal,
          platformFee: plan.platformFeeTotal,
          platformFeePercent: breakdown.seller.platformFeePercent,
          shippingPayout: plan.shippingCostTotal,
          sellerEarnings: sellerEarningsWithBoost,
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
        // LIFECYCLE: born as 'paid' so buyer can cancel BEFORE shipment.
        // Move to 'shipped' only when a seller dispatches (order/:id/ship).
        // Label is auto-created but dispatch is manual — that is the cancel window.
        status: 'paid',
        payout: { status: 'pending', transactionId: paymentIntentId },
        autoTracking: { enabled: true, lastChecked: new Date(), nextCheck: new Date(Date.now() + 86400000), attempts: 0 },
        offer: offer ? offer._id : null,
        negotiatedPrice: isNegotiated ? salePrice : null,
        isNegotiated: isNegotiated,
      });

      createdTransactions.push(txn);
      
      if (offer) {
        offer.status = 'completed';
        offer.transaction = txn._id;
        await offer.save();
      }

      // ZERO-LEAKAGE QUANTITY FIX: decrement by exact qty, mark sold
      // only when ALL remaining stock is gone.
      const remainingAfter = Math.max(0, listing.quantity - plan.qty);
      const updated = await Listing.findOneAndUpdate(
        { _id: listing._id, quantity: { $gt: 0 } },
        {
          $inc: { quantity: -plan.qty, quantitySold: plan.qty },
          $set: remainingAfter === 0 ? { sold: true, available: false } : {},
        },
        { new: true }
      );
      inventoryChanges.push({ listingId: listing._id, updated });

      const payout = await Payout.create({
        seller: listing.seller,
        transaction: txn._id,
        listing: listing._id,
        salePrice: plan.itemSubtotal,
        commissionRate: breakdown.seller.platformFeePercent / 100,
        commissionAmount: plan.platformFeeTotal,
        payoutAmount: sellerEarningsWithBoost,
        status: 'pending',
        // ZERO-LEAKAGE IDEMPOTENCY: store the payment intent so confirm-batch
        // dedupe actually finds it (R1 critical fix — prevents double charge).
        paymentIntentId,
      });
      createdPayouts.push(payout);

      sellerBalanceUpdates.push({
        sellerDoc: seller,
        earnings: sellerEarningsWithBoost,
        listingId: listing._id,
        transactionId: txn._id,
        sellerCurrency: breakdown.sellerCurrency,
      });
    }

    // ========== PHASE 4: Update seller balances + notifications ==========
    for (const update of sellerBalanceUpdates) {
      const { sellerDoc, earnings, listingId, transactionId, sellerCurrency } = update;
      if (sellerDoc) {
        sellerDoc.balance.pending = (sellerDoc.balance.pending || 0) + earnings;
        sellerDoc.notifications.unshift({
          type: 'sale',
          from: req.user._id,
          listing: listingId,
          transaction: transactionId,
          message: `Item sold! You'll earn ${earnings} ${sellerCurrency}.`,
        });
        await sellerDoc.save();
      }
    }

    // Populate all transactions
    for (const txn of createdTransactions) {
      await txn.populate(['buyer', 'seller', 'listing']);
    }

    // ========== ENTERPRISE ORDER: group all txns into one order ==========
    // One checkout = one Order. Each seller gets their own shipment.
    // Same-seller items are bundled into a single shipment with bundle
    // shipping pricing (max single-item shipping, free if all free).
    let createdOrder = null;
    try {
      const sellerGroups = new Map();
      orderPlans.forEach((plan, i) => {
        const txn = createdTransactions[i];
        if (!txn) return;
        const key = plan.seller._id.toString();
        if (!sellerGroups.has(key)) {
          sellerGroups.set(key, { seller: plan.seller, items: [], txns: [] });
        }
        const g = sellerGroups.get(key);
        g.items.push({
          shippingCost: plan.breakdown.buyer.shippingCost || 0,
          freeShipping: !!plan.listing.shipping?.freeShipping,
          // plan has no `toCurrency`; per-sale currency is the listing's
          // currency which is what the buyer is actually charged in.
          currency: plan.listing.currency || plan.breakdown.sellerCurrency || 'USD',
        });
        g.txns.push({ txn, plan });
      });

      const shipments = [];
      const orderItems = [];
      let shippingTotal = 0;
      let protectionTotal = 0;
      let subtotalTotal = 0;

      for (const group of sellerGroups.values()) {
        // Bundle shipping: same-seller multiple items → one label
        const bundle = Order.calculateBundleShipping(group.items);
        const shipmentTxns = group.txns.map((g) => g.txn._id);
        const first = group.txns[0];
        shipments.push({
          seller: group.seller._id,
          items: shipmentTxns,
          shippingCost: bundle.shippingCost,
          currency: first.plan.breakdown.sellerCurrency || 'USD',
          labelStatus: 'created',
          status: 'pending',
        });

        for (const g of group.txns) {
          const t = g.txn;
          const l = t.listing || {};
          orderItems.push({
            listing: t.listing._id || l._id,
            transaction: t._id,
            seller: t.seller._id || group.seller._id,
            title: l.title || '',
            price: t.itemPrice || 0,
            quantity: t.quantity || 1,
            currency: t.currency || 'USD',
            image: (l.images && l.images[0]) || '',
            condition: l.condition || '',
            size: l.size || '',
            brand: l.brand || '',
          });
          subtotalTotal += t.itemPrice || 0;
          protectionTotal += t.paymentBreakdown?.buyerProtectionFee || 0;
        }
        shippingTotal += bundle.shippingCost;
      }

      const totalHeld = Math.round((subtotalTotal + shippingTotal + protectionTotal) * 100) / 100;
      // ACTUAL discount total = promo + bundle. NEVER treat the held amount
      // itself as a "discount" when no promo/bundle was applied.
      const discountTotal = (paymentIntent.metadata?.promoDiscount
        ? Number(paymentIntent.metadata.promoDiscount) : 0)
        + (paymentIntent.metadata?.bundleDiscount ? Number(paymentIntent.metadata.bundleDiscount) : 0);

      createdOrder = await Order.create({
        buyer: req.user._id,
        sellers: [...sellerGroups.keys()],
        currency: 'USD',
        items: orderItems,
        shipments,
        totals: {
          subtotal: subtotalTotal,
          shipping: shippingTotal,
          protectionFees: protectionTotal,
          discounts: Math.max(0, Math.round(discountTotal * 100) / 100),
          total: Math.max(0, Math.round((totalHeld - discountTotal) * 100) / 100),
        },
        payment: {
          paymentIntentId,
          status: 'captured',
          currency: 'USD',
          totalHeld,
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
        confirmation: {
          sentAt: new Date(),
          approach: 'email_and_push',
          emailSent: false,
          pushSent: false,
        },
      });
    } catch (orderErr) {
      // Order is a grouping convenience; core money flow must not be
      // rolled back if order grouping fails, but log loudly for SRE.
      console.error('Order creation failed (transactions still committed):', orderErr.message);
    }

    // ===== Apply promo code usage if present =====
    if (paymentIntent.metadata?.appliedPromoId) {
      try {
        const promo = await Promo.findById(paymentIntent.metadata.appliedPromoId);
        if (promo) {
          promo.usageCount = (promo.usageCount || 0) + 1;
          await promo.save();
        }
      } catch (e) {
        console.error('Failed to increment promo usage:', e.message);
      }
    }

    res.json({
      transactions: createdTransactions,
      captureResult: { id: captureResult.id, status: captureResult.status },
      orders: createdOrder ? [createdOrder] : [],
    });

  } catch (error) {
    console.error('Confirm batch payment error:', error);

    // Rollback
    if (captured && req.body.paymentIntentId) {
      try { await issueRefund(req.body.paymentIntentId); } catch (e) { console.error('Refund rollback failed:', e.message); }
    }
    if (!captured && req.body.paymentIntentId) {
      try { await releaseAuthorization(req.body.paymentIntentId); } catch (e) { console.error('Release rollback failed:', e.message); }
    }

    for (const payout of createdPayouts) {
      try { await Payout.findByIdAndDelete(payout._id); } catch (e) {}
    }
    for (const txn of createdTransactions) {
      try { await Transaction.findByIdAndDelete(txn._id); } catch (e) {}
    }
    for (const change of inventoryChanges) {
      if (!change.updated) {
        try {
          await Listing.findOneAndUpdate(
            { _id: change.listingId },
            { $inc: { quantity: 1, quantitySold: -1 } },
            { new: true }
          );
        } catch (e) {}
      }
    }

    res.status(500).json({ message: error.message || 'Error confirming batch payment' });
  }
});

// STEP 2: Single item confirm + capture
router.post('/confirm', auth, async (req, res) => {
  let createdTransaction = null;
  let captured = false;

  try {
    const { paymentIntentId, listingId, shippingAddress } = req.body;

    if (!paymentIntentId) return res.status(400).json({ message: 'Missing paymentIntentId' });

    const paymentIntent = await retrievePaymentIntent(paymentIntentId);
    const VALID_STATUSES = ['succeeded', 'requires_capture'];
    if (!VALID_STATUSES.includes(paymentIntent.status)) {
      return res.status(400).json({
        message: `Payment not authorized. Status: ${paymentIntent.status}`,
      });
    }

    const existingTxn = await Transaction.findOne({ 'payout.transactionId': paymentIntentId });
    if (existingTxn) {
      return res.json({ message: 'Order already exists for this payment', transaction: existingTxn });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (!listing.available || listing.sold || listing.quantity <= 0) {
      return res.status(400).json({ message: 'Item sold out' });
    }

    const seller = await User.findById(listing.seller);
    const sellerCountry = seller?.country || listing.shipsFrom || 'US';
    const toCountry = shippingAddress?.country || req.user.country || 'US';
    const breakdown = calculatePaymentBreakdown(listing.price, sellerCountry, toCountry, listing.weight || 0.5);

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

    // Boost fee: flat % of sale price, charged only upon successful sale
    const boostFee = getBoostFee(listing, listing.price);

    // Item-level boost fee ledger (this listing only)
    await recordBoostFeeOwed(listing._id, boostFee, 1);

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
      // LIFECYCLE: born as 'paid' for pre-shipment cancellation (R3 fix same as batch)
      status: 'paid',
      payout: { status: 'pending', transactionId: paymentIntentId },
      autoTracking: { enabled: true, lastChecked: new Date(), nextCheck: new Date(Date.now() + 86400000), attempts: 0 },
    });

    const captureResult = await capturePaymentIntent(paymentIntentId);
    captured = true;

    const wasLastOne = listing.quantity === 1;
    const inventoryUpdate = await Listing.findOneAndUpdate(
      { _id: listingId, quantity: { $gt: 0 } },
      { $inc: { quantity: -1, quantitySold: 1 }, $set: wasLastOne ? { sold: true, available: false } : {} },
      { new: true }
    );

    if (!inventoryUpdate) {
      await issueRefund(paymentIntentId);
      createdTransaction.status = 'refunded';
      createdTransaction.payout.status = 'refunded';
      await createdTransaction.save();
      return res.status(400).json({ message: 'Item sold out between authorization and capture. Full refund issued.' });
    }

    if (seller) {
      seller.balance.pending = (seller.balance.pending || 0) + (breakdown.seller.sellerEarnings - boostFee);
      seller.notifications.unshift({
        type: 'sale',
        from: req.user._id,
        listing: listing._id,
        transaction: createdTransaction._id,
        message: `Item sold! You'll earn ${Math.round((breakdown.seller.sellerEarnings - boostFee) * 100) / 100} ${breakdown.sellerCurrency}. Shipping label ready.`,
      });
      await seller.save();
    }

    try {
      const existingPayout = await Payout.findOne({ transaction: createdTransaction._id });
      if (!existingPayout) {
        await Payout.create({
          seller: listing.seller,
          transaction: createdTransaction._id,
          listing: listingId,
          salePrice: breakdown.buyer.itemPrice,
          commissionRate: breakdown.seller.platformFeePercent / 100,
          commissionAmount: breakdown.seller.platformFee,
          payoutAmount: breakdown.seller.sellerEarnings - boostFee,
          status: 'pending',
          // R1 idempotency: tie payout to payment intent for dedupe
          paymentIntentId,
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

    if (!captured && req.body.paymentIntentId) {
      try { await releaseAuthorization(req.body.paymentIntentId); } catch (e) {}
    }
    if (captured && req.body.paymentIntentId) {
      try { await issueRefund(req.body.paymentIntentId); } catch (e) {}
    }
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