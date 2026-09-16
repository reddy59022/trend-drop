const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Cart = require('../models/Cart');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { calculatePaymentBreakdown } = require('../config/payments');
const { getPreferredCarrier, generateLabel } = require('../config/shipping');
const { isValidObjectId } = require('../utils/validators');
const { createPurchaseRollback } = require('../utils/purchaseRollback');
const { saleNotification } = require('../utils/saleNotification');

// Shared per-line pricing for cart checkout (TDD R26). The amount-parity
// gate and the commit loop MUST use identical math, so it lives in ONE
// function. Mirrors create-intent's authorization math (routes/payments.js):
// item subtotal and buyer protection scale linearly with qty; shipping is
// charged per label on the COMBINED weight. `price` is the resolved price
// basis (list price, or the accepted-offer price the buyer actually paid for)
// — see the PRICE BASIS section in POST /checkout.
const computeCartLineFinancials = (listing, seller, sellerCountry, toCountry, qty, price) => {
  const salePrice = price != null ? price : listing.price;
  const combinedWeight = Math.round(((listing.weight || 0.5) * qty) * 1000) / 1000;
  const breakdown = calculatePaymentBreakdown(
    salePrice,
    sellerCountry,
    toCountry,
    combinedWeight
  );
  const itemSubtotal = Math.round(salePrice * qty * 100) / 100;
  const protectionTotal = Math.round(breakdown.buyer.buyerProtectionFee * qty * 100) / 100;
  const lineTotal = Math.round((itemSubtotal + breakdown.buyer.shippingCost + protectionTotal) * 100) / 100;
  const platformTotal = Math.round(breakdown.seller.platformFee * qty * 100) / 100;
  const earningsTotal = Math.round(breakdown.seller.sellerEarnings * qty * 100) / 100;
  return { combinedWeight, breakdown, itemSubtotal, protectionTotal, lineTotal, platformTotal, earningsTotal };
};

// The only thing that may legitimately lower a cart line's charge is an
// ACCEPTED offer, and it is always resolved SERVER-SIDE for THIS buyer (never
// from client-supplied price data). Mirrors create-intent / confirm-batch.
const resolveAcceptedOfferPrice = async (listing, buyerId) => {
  const offer = await Offer.findOne({
    listing: listing._id,
    buyer: buyerId,
    status: 'accepted',
  }).select('acceptedPrice counterAmount amount');
  if (!offer) return null;
  const raw = offer.acceptedPrice != null
    ? offer.acceptedPrice
    : (offer.counterAmount != null ? offer.counterAmount : offer.amount);
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
};

// ===================== ABANDONED CART RECOVERY =====================
// Cart management with automatic expiration and email/SMS reminders

// GET /api/cart - Get user cart
router.get('/', auth, async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id, status: 'active' });

    // Create cart if doesn't exist
    if (!cart) {
      cart = await Cart.create({
        user: req.user._id,
        items: [],
        status: 'active',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    }

    // Filter out items for listings that are no longer available.
    // IMPORTANT: filter on RAW listing ids BEFORE populating — saving a
    // populated cart embeds the listing objects into items.listing, which
    // breaks subsequent populate() calls and silently empties the cart
    // (found by E2E: add-to-cart then refresh lost the item).
    if (cart.items && cart.items.length > 0) {
      const rawIds = cart.items.map(item => item.listing).filter(Boolean);
      const validListings = await Listing.find({
        _id: { $in: rawIds },
        available: true,
        sold: false,
      }).select('_id');
      const validIds = new Set(validListings.map(l => l._id.toString()));
      const kept = cart.items.filter(item => item.listing && validIds.has(item.listing.toString()));
      if (kept.length !== cart.items.length) {
        cart.items = kept;
        await cart.save();
      }
    }

    await cart.populate('items.listing', 'title price images available sold quantity category weight');
    res.json({ cart });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ message: 'Failed to fetch cart' });
  }
});

// POST /api/cart/items - Add item to cart
router.post('/items', auth, async (req, res) => {
  try {
    const { listingId, quantity = 1 } = req.body;

    if (!listingId || !isValidObjectId(listingId)) {
      return res.status(400).json({ message: 'listingId is required' });
    }

    // Quantity must be a positive whole unit: zero/negative/fractional values
    // would otherwise corrupt line totals and stock accounting downstream.
    const numericQuantity = Number(quantity);
    if (!Number.isInteger(numericQuantity) || numericQuantity <= 0) {
      return res.status(400).json({ message: 'Quantity must be a positive integer' });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    // TDD-B2: cannot add your own listing to cart (parity with purchase gates).
    if (listing.seller && listing.seller.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot add your own listing to cart' });
    }

    // Check if item is available
    if (!listing.available || listing.sold) {
      return res.status(400).json({ message: 'Item is no longer available' });
    }

    // Check if quantity requested is available
    if (listing.quantity < numericQuantity) {
      return res.status(400).json({ message: `Only ${listing.quantity} available in stock` });
    }

    let cart = await Cart.findOne({ user: req.user._id, status: 'active' });

    if (!cart) {
      cart = await Cart.create({
        user: req.user._id,
        items: [],
        status: 'active',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    }

    // Check if item already in cart
    const existingItemIndex = cart.items.findIndex(
      item => item.listing.toString() === listingId.toString()
    );

    if (existingItemIndex >= 0) {
      cart.items[existingItemIndex].quantity = numericQuantity;
    } else {
      cart.items.push({
        listing: listingId,
        quantity: numericQuantity,
        addedAt: new Date(),
      });
    }

    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate('items.listing', 'title price images available sold quantity');

    res.json({ cart: populatedCart });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ message: 'Failed to add item to cart' });
  }
});

// DELETE /api/cart/items/:id - Remove item from cart
router.delete('/items/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const cart = await Cart.findOne({ user: req.user._id, status: 'active' });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    cart.items = cart.items.filter(item => item.listing.toString() !== id);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate('items.listing', 'title price images');

    res.json({ cart: populatedCart });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ message: 'Failed to remove item from cart' });
  }
});

// POST /api/cart/checkout - Convert cart to order (creates transaction)
router.post('/checkout', auth, async (req, res) => {
  // Declared outside try so the catch can compensate a partially-committed
  // multi-item cart (the tracker is populated after the payment gate passes).
  const rollback = createPurchaseRollback();
  try {
    const { shippingAddress, paymentIntentId } = req.body;

    // ============================================================
    // PAYMENT GATE (Bug B2): a cart must never be fulfilled without a real,
    // authorized payment. Before this gate the endpoint created transactions,
    // marked listings sold and credited sellers with NO charge at all — an
    // authenticated buyer could "checkout" a cart and never pay.
    // Never trust a client-supplied id: verify the intent against the payment
    // backend so only genuinely authorized payments proceed.
    // ============================================================
    if (!paymentIntentId) {
      return res.status(400).json({
        message: 'A confirmed paymentIntentId is required. Use /api/payments/create-intent + /api/payments/confirm-batch instead.',
      });
    }
    const { findPaymentIntent } = require('../config/payments');
    const { verifyIntentBinding } = require('../config/payments');
    const { verifyIntentAmount } = require('../config/payments');
    let pi;
    try {
      pi = await findPaymentIntent(paymentIntentId);
    } catch (piErr) {
      console.error('Cart checkout intent lookup error:', piErr.message);
      return res.status(400).json({ message: 'Payment intent could not be verified' });
    }
    if (!pi || !['requires_capture', 'succeeded'].includes(pi.status)) {
      return res.status(400).json({
        message: `Payment not authorized. Status: ${pi?.status || 'unknown'}`,
      });
    }

    // TDD-B1: one authorization funds exactly ONE checkout. Without this the
    // same intent id could be replayed against every cart for free.
    const intentAlreadyUsed = await Transaction.findOne({
      'paymentBreakdown.paymentIntentId': pi.id,
    }).select('_id');
    if (intentAlreadyUsed) {
      return res.status(400).json({
        message: 'This payment has already been used for another purchase.',
      });
    }

    const cart = await Cart.findOne({ user: req.user._id, status: 'active' })
      .populate('items.listing');

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    // A failed checkout must leave the cart usable ('active'), never stuck.
    rollback.track.addCart(cart._id);

    // ============================================================
    // INTENT BINDING (TDD-B1): the intent must have been authorized for THIS
    // buyer and THIS cart's items. create-intent stores buyerId + itemIds in
    // the intent metadata, so an intent authorized for a $1 decoy item can
    // never fulfil a cart full of other listings.
    // ============================================================
    const binding = verifyIntentBinding(pi, {
      buyerId: req.user._id,
      listingIds: cart.items.map((it) => it.listing?._id || it.listing),
    });
    if (!binding.ok) {
      return res.status(400).json({ message: binding.reason });
    }

    // Compensating-transaction tracker: one bad line must not leave the rest
    // of the cart committed (money held, items sold, cart stuck purchased).
    rollback.track.setIntent(pi.id);

    // Validate all items are still available
    for (const item of cart.items) {
      const listing = await Listing.findById(item.listing._id || item.listing);
      if (!listing || !listing.available || listing.sold) {
        return res.status(400).json({ message: `"${listing?.title || 'Item'}" is no longer available` });
      }
      // TDD-B2 (defense in depth): cart-add blocks self-listings, but a cart
      // written before that guard — or seeded directly — must not be
      // redeemable at checkout either, or the purchase gates are bypassable.
      if (listing.seller && listing.seller.toString() === req.user._id.toString()) {
        return res.status(400).json({ message: 'Cannot purchase your own listing' });
      }
      // TDD-B3: validate EVERY line quantity up-front so a multi-item cart
      // never partially commits when one line is short on stock.
      const qty = Math.max(1, Math.floor(item.quantity || 1));
      if (listing.quantity < qty) {
        return res.status(400).json({ message: `Only ${listing.quantity} left of "${listing.title}"` });
      }
    }

    // Get buyer info
    const buyer = await User.findById(req.user._id);
    if (!buyer) {
      return res.status(404).json({ message: 'Buyer not found' });
    }

    const toCountry = shippingAddress?.country || buyer.country || 'US';

    // ============================================================
    // Feature 2 — International shipping flag.
    // When disabled, every item in the cart may only ship WITHIN the
    // seller's own country. Validated for ALL items before anything is
    // created so a mixed cart never partially commits.
    // ============================================================
    const { isInternationalAllowed } = require('../config/shipping');
    for (const item of cart.items) {
      const l = await Listing.findById(item.listing._id || item.listing);
      if (!l) continue;
      const s = await User.findById(l.seller).select('country');
      const sellerCountry = s?.country || l.shipsFrom || 'US';
      if (!isInternationalAllowed(sellerCountry, toCountry)) {
        return res.status(400).json({
          supported: false,
          message: "International shipping is currently disabled. Items can only be shipped within the seller's country.",
        });
      }
    }

    // ============================================================
    // REVENUE INTEGRITY (TDD R26): AMOUNT PARITY + PRICE BASIS.
    //
    // AMOUNT PARITY: the binding gate above proves the intent was authorized
    // by THIS buyer for THESE items, but binding metadata carries only
    // itemIds — NOT quantities. Without an amount check, a buyer can authorize
    // ONE unit, inflate the cart line to N units, and checkout: the seller
    // would be credited N× earnings (plus N-unit shipping/protection) that
    // were never authorized, and the platform funds the gap. Buy-now
    // (routes/transactions.js), offers and confirm-batch (routes/payments.js)
    // already enforce this via verifyIntentAmount — the cart was the only
    // money path missing it. Planned totals use the SAME math as the commit
    // loop below (shared computeCartLineFinancials) and mirror create-intent's
    // authorization (its line totals minus the promo/bundle discounts it
    // already subtracted from the authorized amount).
    //
    // PRICE BASIS: an accepted offer is the only thing that may legitimately
    // lower a line's charge. The client's Cart page sends `negotiatedPrice` to
    // create-intent, which resolves the accepted offer SERVER-SIDE and
    // authorizes the OFFER total; but this endpoint priced every line at
    // listing.price and ignored offers entirely — so an offer-priced
    // authorization was billed/credited at list price (the platform funds the
    // gap), and with an amount gate it would dead-end forever. The basis is
    // resolved here, server-side, from the AUTHORIZATION: use the list basis
    // when it is covered, else the offer basis. Nothing client-supplied is
    // trusted, and whatever the buyer paid for is what gets recorded.
    // Authoritative-only semantics live inside verifyIntentAmount: intents
    // without a real amount + binding metadata (legacy test mocks) pass and
    // keep the list-price behaviour.
    // ============================================================
    const plannedLines = [];
    const plannedPriceByListing = new Map();
    let listTotal = 0;
    let offerTotal = 0;
    let hasOfferBasis = false;
    for (const item of cart.items) {
      const plannedListing = await Listing.findById(item.listing?._id || item.listing);
      if (!plannedListing) continue; // availability was already rejected above
      const plannedQty = Math.max(1, Math.floor(item.quantity || 1));
      const plannedSeller = await User.findById(plannedListing.seller);
      const plannedSellerCountry = plannedSeller?.country || plannedListing.shipsFrom || 'US';
      const offerPrice = await resolveAcceptedOfferPrice(plannedListing, req.user._id);

      const listLine = computeCartLineFinancials(
        plannedListing, plannedSeller, plannedSellerCountry, toCountry, plannedQty, plannedListing.price
      );
      listTotal += listLine.lineTotal;

      if (offerPrice != null) {
        hasOfferBasis = true;
        const offerLine = computeCartLineFinancials(
          plannedListing, plannedSeller, plannedSellerCountry, toCountry, plannedQty, offerPrice
        );
        offerTotal += offerLine.lineTotal;
        plannedLines.push({ listing: plannedListing, offerPrice });
      } else {
        offerTotal += listLine.lineTotal;
        plannedLines.push({ listing: plannedListing, offerPrice: null });
      }
    }

    const round2 = (n) => Math.round(n * 100) / 100;
    const metaDiscount = (Number(pi.metadata?.promoDiscount) || 0) + (Number(pi.metadata?.bundleDiscount) || 0);
    const expectedListCents = Math.round((round2(listTotal) - metaDiscount) * 100);
    const expectedOfferCents = Math.round((round2(offerTotal) - metaDiscount) * 100);

    const authorizedCents = Number(pi.amount);
    const authorizedIsReal = Number.isFinite(authorizedCents) && authorizedCents > 0
      && (pi.metadata?.buyerId || pi.metadata?.itemIds);
    let priceBasis = 'list';
    if (authorizedIsReal && hasOfferBasis
      && authorizedCents < expectedListCents && authorizedCents >= expectedOfferCents) {
      priceBasis = 'offer';
    }

    const expectedCents = priceBasis === 'offer' ? expectedOfferCents : expectedListCents;
    for (const planned of plannedLines) {
      plannedPriceByListing.set(
        String(planned.listing._id),
        priceBasis === 'offer' && planned.offerPrice != null ? planned.offerPrice : planned.listing.price
      );
    }

    const amountCheck = verifyIntentAmount(pi, expectedCents);
    if (!amountCheck.ok) {
      return res.status(400).json({ message: amountCheck.reason });
    }

    // Process each item in cart
    const createdTransactions = [];

    for (const item of cart.items) {
      const listing = await Listing.findById(item.listing._id || item.listing);
      // TDD-B3: honor cart line quantity (validate stock, scale totals).
      const qty = Math.max(1, Math.floor(item.quantity || 1));
      if (listing.quantity < qty) {
        return res.status(400).json({ message: `Only ${listing.quantity} left of "${listing.title}"` });
      }
      const seller = await User.findById(listing.seller);
      const sellerCountry = seller?.country || listing.shipsFrom || 'US';

      // Same price basis the amount gate just validated (never re-derived, so
      // authorization and recorded money can never drift apart).
      const salePrice = plannedPriceByListing.has(String(listing._id))
        ? plannedPriceByListing.get(String(listing._id))
        : listing.price;

      const { combinedWeight, breakdown, itemSubtotal, protectionTotal, lineTotal, platformTotal, earningsTotal } =
        computeCartLineFinancials(listing, seller, sellerCountry, toCountry, qty, salePrice);

      const sellerAddress = seller?.shippingAddress ? {
        street1: seller.shippingAddress.street1,
        city: seller.shippingAddress.city,
        state: seller.shippingAddress.state,
        postalCode: seller.shippingAddress.postalCode,
        country: seller.shippingAddress.country || sellerCountry,
      } : { country: sellerCountry };

      const carrierCode = getPreferredCarrier(toCountry, sellerCountry === toCountry);
      const label = generateLabel({
        shippingAddress: { fullName: shippingAddress?.fullName || buyer.name, ...shippingAddress },
        sellerAddress,
        weight: combinedWeight,
      }, carrierCode);

      const transaction = await Transaction.create({
        listing: listing._id,
        buyer: req.user._id,
        seller: listing.seller,
        quantity: qty,
        itemPrice: itemSubtotal,
        currency: listing.currency || 'USD',
        paymentBreakdown: {
          subtotal: itemSubtotal,
          shippingCost: breakdown.buyer.shippingCost,
          buyerProtectionFee: protectionTotal,
          buyerProtectionPercent: breakdown.buyer.buyerProtectionPercent,
          tax: 0,
          totalPaid: lineTotal,
          platformFee: platformTotal,
          platformFeePercent: breakdown.seller.platformFeePercent,
          shippingPayout: breakdown.seller.shippingPayout,
          sellerEarnings: earningsTotal,
          // TDD-B1: canonical provider id (never the raw client string) so one
          // authorization can never fund a second purchase / confirm-batch replay.
          paymentIntentId: pi.id,
        },
        shippingAddress: {
          fullName: shippingAddress?.fullName || buyer.name,
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
        payout: { status: 'pending', transactionId: pi.id },
      });

      createdTransactions.push(transaction);
      rollback.track.addTransaction(transaction._id, pi.id);

      // Update listing inventory (TDD-B3: decrement by qty, sold when depleted).
      // The conditional update is the stock authority: if it matches nothing
      // another checkout won the last unit, so this purchase must be rolled
      // back (no credit, no payout, no transaction) exactly like
      // POST /api/transactions does.
      const depleted = listing.quantity <= qty;
      const inventoryUpdate = await Listing.findOneAndUpdate(
        { _id: listing._id, quantity: { $gte: qty } },
        { $inc: { quantity: -qty, quantitySold: qty }, $set: depleted ? { sold: true, available: false } : {} },
        { new: true }
      );

      if (!inventoryUpdate) {
        await rollback.run();
        return res.status(400).json({ message: `Sorry, "${listing.title}" just went out of stock` });
      }
      rollback.track.addInventory(listing._id, qty);

      // Update seller balance and send notification — ATOMICALLY ($inc +
      // prepend), so concurrent checkouts touching the same seller never
      // race on document versioning.
      if (seller) {
        await User.updateOne(
          { _id: seller._id },
          {
            $inc: { 'balance.pending': earningsTotal },
            $push: {
              notifications: {
                $each: [saleNotification({
                  from: req.user._id,
                  listing: listing._id,
                  transaction: transaction._id,
                  message: `Item sold from cart! You'll earn ${earningsTotal} ${breakdown.sellerCurrency}. Shipping label ready.`,
                })],
                $position: 0,
              },
            },
          }
        );
        // Only revertible once persisted — no phantom pending earnings.
        rollback.track.addSellerCredit(seller._id, earningsTotal);
      }

      // Create payout record
      const payout = await Payout.create({
        seller: listing.seller,
        transaction: transaction._id,
        listing: listing._id,
        salePrice: itemSubtotal,
        commissionRate: breakdown.seller.platformFeePercent / 100,
        commissionAmount: platformTotal,
        payoutAmount: earningsTotal,
        status: 'pending',
      });
      rollback.track.addPayout(payout._id);
    }

    // Mark cart as purchased
    cart.status = 'purchased';
    await cart.save();

    res.json({
      transaction: createdTransactions[0], // Return first transaction for simplicity
      transactions: createdTransactions,
      message: 'Cart checkout completed successfully',
    });
  } catch (error) {
    console.error('Cart checkout error:', error);
    // Money-only-upon-success: a partially-committed multi-item checkout must
    // be undone entirely — no transactions, no depleted inventory, no phantom
    // seller earnings/payouts, no live payment hold, and the cart stays usable.
    await rollback.run();
    res.status(500).json({ message: 'Failed to checkout cart' });
  }
});

// GET /api/cart/recovery/settings - Get cart recovery settings
router.get('/recovery/settings', (req, res) => {
  res.json({
    enabled: true,
    reminderHours: 24, // Hours before sending reminder
    maxReminders: 3, // Max reminders per cart
    expirationDays: 7, // Cart expires after days
    escalationEnabled: true, // Send additional reminders for high-value carts
  });
});

// POST /api/cart/expired - Mark cart as expired (for cron jobs)
router.post('/expired', auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id, status: 'active' });

    if (!cart) {
      return res.status(404).json({ message: 'No active cart found' });
    }

    if (cart.expiresAt < new Date()) {
      cart.status = 'expired';
      await cart.save();
    }

    res.json({ cart });
  } catch (error) {
    console.error('Expire cart error:', error);
    res.status(500).json({ message: 'Failed to expire cart' });
  }
});

// POST /api/cart/abandon - Mark cart as abandoned (for reminder system)
router.post('/abandon', auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id, status: 'active' });

    if (!cart) {
      return res.status(404).json({ message: 'No active cart found' });
    }

    // Only mark as abandoned if older than reminder threshold
    const hoursSinceCreation = (Date.now() - cart.createdAt) / (1000 * 60 * 60);

    if (hoursSinceCreation >= 24) {
      cart.status = 'abandoned';
      cart.reminderSent = true;
      cart.reminderSentAt = new Date();
      await cart.save();

      // Notify user via in-app notification
      const user = await User.findById(req.user._id);
      if (user) {
        user.notifications.unshift({
          type: 'shipping',
          message: 'Your cart is waiting! Complete your purchase before items sell out.',
        });
        await user.save();
      }
    }

    res.json({ cart });
  } catch (error) {
    console.error('Abandon cart error:', error);
    res.status(500).json({ message: 'Failed to abandon cart' });
  }
});

module.exports = router;