const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Cart = require('../models/Cart');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { calculatePaymentBreakdown } = require('../config/payments');
const { getPreferredCarrier, generateLabel } = require('../config/shipping');

// ===================== ABANDONED CART RECOVERY =====================
// Cart management with automatic expiration and email/SMS reminders

// GET /api/cart - Get user cart
router.get('/', auth, async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id, status: 'active' })
      .populate('items.listing', 'title price images available sold quantity category weight');

    // Create cart if doesn't exist
    if (!cart) {
      cart = await Cart.create({
        user: req.user._id,
        items: [],
        status: 'active',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    }

    // Filter out items for listings that are no longer available
    if (cart.items && cart.items.length > 0) {
      cart.items = cart.items.filter(item => item.listing && item.listing.available && !item.listing.sold);
      await cart.save();
    }

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

    if (!listingId) {
      return res.status(400).json({ message: 'listingId is required' });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    // Check if item is available
    if (!listing.available || listing.sold) {
      return res.status(400).json({ message: 'Item is no longer available' });
    }

    // Check if quantity requested is available
    if (listing.quantity < quantity) {
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
      cart.items[existingItemIndex].quantity = quantity;
    } else {
      cart.items.push({
        listing: listingId,
        quantity,
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
  try {
    const { shippingAddress } = req.body;

    const cart = await Cart.findOne({ user: req.user._id, status: 'active' })
      .populate('items.listing');

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    // Validate all items are still available
    for (const item of cart.items) {
      const listing = await Listing.findById(item.listing._id || item.listing);
      if (!listing || !listing.available || listing.sold) {
        return res.status(400).json({ message: `"${listing?.title || 'Item'}" is no longer available` });
      }
    }

    // Get buyer info
    const buyer = await User.findById(req.user._id);
    if (!buyer) {
      return res.status(404).json({ message: 'Buyer not found' });
    }

    const toCountry = shippingAddress?.country || buyer.country || 'US';

    // Process each item in cart
    const createdTransactions = [];

    for (const item of cart.items) {
      const listing = await Listing.findById(item.listing._id || item.listing);
      const seller = await User.findById(listing.seller);
      const sellerCountry = seller?.country || listing.shipsFrom || 'US';

      const breakdown = calculatePaymentBreakdown(
        listing.price,
        sellerCountry,
        toCountry,
        listing.weight || 0.5
      );

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
        weight: listing.weight || 0.5,
      }, carrierCode);

      const transaction = await Transaction.create({
        listing: listing._id,
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
      });

      createdTransactions.push(transaction);

      // Update listing inventory
      const wasLastOne = listing.quantity === 1;
      await Listing.findOneAndUpdate(
        { _id: listing._id, quantity: { $gt: 0 } },
        { $inc: { quantity: -1, quantitySold: 1 }, $set: wasLastOne ? { sold: true, available: false } : {} },
        { new: true }
      );

      // Update seller balance and send notification
      if (seller) {
        seller.balance.pending = (seller.balance.pending || 0) + breakdown.seller.sellerEarnings;
        seller.notifications.unshift({
          type: 'sale',
          from: req.user._id,
          listing: listing._id,
          transaction: transaction._id,
          message: `Item sold from cart! You'll earn ${breakdown.seller.sellerEarnings} ${breakdown.sellerCurrency}. Shipping label ready.`,
        });
        await seller.save();
      }

      // Create payout record
      await Payout.create({
        seller: listing.seller,
        transaction: transaction._id,
        listing: listing._id,
        salePrice: breakdown.buyer.itemPrice,
        commissionRate: breakdown.seller.platformFeePercent / 100,
        commissionAmount: breakdown.seller.platformFee,
        payoutAmount: breakdown.seller.sellerEarnings,
        status: 'pending',
      });
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