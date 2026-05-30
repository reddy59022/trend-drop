const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { verifyStripeWebhook } = require('../config/payments');

// Stripe webhook - uses raw body for signature verification
// This router is mounted BEFORE express.json() in server.js
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  // Guard: if Stripe is not configured, return early
  const { stripe } = require('../config/payments');
  if (!stripe) {
    console.warn('Stripe webhook received but STRIPE_SECRET_KEY not configured. Skipping.');
    return res.json({ received: true, skipped: true });
  }

  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = verifyStripeWebhook(req.body, sig);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ message: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const txn = await Transaction.findOne({ 'payout.transactionId': pi.id, status: 'paid' });
        if (txn) {
          txn.status = 'paid';
          await txn.save();
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const buyerId = pi.metadata?.buyerId;
        if (buyerId) {
          const buyer = await User.findById(buyerId);
          if (buyer) {
            buyer.notifications.unshift({
              type: 'sale',
              message: `Payment failed for your purchase. Please try again.`,
            });
            await buyer.save();
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const piId = charge.payment_intent;
        const txn = await Transaction.findOne({ 'payout.transactionId': piId });
        if (txn) {
          txn.status = 'refunded';
          txn.payout.status = 'refunded';
          txn.payout.processedAt = new Date();
          await txn.save();

          await Listing.findByIdAndUpdate(txn.listing, {
            $inc: { quantity: 1, quantitySold: -1 },
            $set: { sold: false, available: true },
          });

          const seller = await User.findById(txn.seller);
          if (seller) {
            seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - txn.paymentBreakdown.sellerEarnings);
            seller.notifications.unshift({
              type: 'sale',
              listing: txn.listing,
              transaction: txn._id,
              message: `Payment for order was refunded.`,
            });
            await seller.save();
          }
        }
        break;
      }

      case 'payout.paid':
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ message: 'Webhook handler error' });
  }
});

module.exports = router;