const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');

// Stripe webhook endpoint - handles chargeback events
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle chargeback events
    switch (event.type) {
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const paymentIntentId = dispute.payment_intent;
        
        console.log(`Chargeback created for payment: ${paymentIntentId}`);
        
        // Find the transaction by payment intent
        const transaction = await Transaction.findOne({
          'stripePaymentIntentId': paymentIntentId
        });
        
        if (transaction) {
          transaction.status = 'chargeback_open';
          transaction.disputeInfo = {
            stripeDisputeId: dispute.id,
            reason: dispute.reason,
            status: dispute.status,
            openedAt: new Date(),
            evidenceDueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
          };
          await transaction.save();
          
          // Notify seller about the chargeback
          const seller = await User.findById(transaction.seller);
          if (seller) {
            seller.notifications.unshift({
              type: 'dispute',
              from: transaction.buyer,
              listing: transaction.listing,
              transaction: transaction._id,
              message: `A chargeback has been filed for your sale. Please provide evidence.`,
            });
            await seller.save();
          }
        }
        break;
      }

      case 'charge.dispute.updated': {
        const dispute = event.data.object;
        
        console.log(`Chargeback updated: ${dispute.id} -> status: ${dispute.status}`);
        
        // Find transaction by stripe dispute ID
        const transaction = await Transaction.findOne({
          'disputeInfo.stripeDisputeId': dispute.id
        });
        
        if (transaction) {
          // If won, restore funds to seller
          if (dispute.status === 'won') {
            transaction.status = 'chargeback_won';
            // Restore seller's pending balance
            if (transaction.paymentBreakdown?.sellerEarnings) {
              const seller = await User.findById(transaction.seller);
              if (seller) {
                seller.balance.pending = (seller.balance.pending || 0) + transaction.paymentBreakdown.sellerEarnings;
                seller.notifications.unshift({
                  type: 'dispute',
                  from: transaction.buyer,
                  listing: transaction.listing,
                  transaction: transaction._id,
                  message: `Chargeback resolved in your favor. Funds restored.`,
                });
                await seller.save();
              }
            }
          } else if (dispute.status === 'lost') {
            transaction.status = 'chargeback_lost';
            // Deduct from seller's balance if available
            if (transaction.paymentBreakdown?.sellerEarnings) {
              const seller = await User.findById(transaction.seller);
              if (seller) {
                const amount = transaction.paymentBreakdown.sellerEarnings;
                const currentPending = seller.balance.pending || 0;
                if (currentPending >= amount) {
                  seller.balance.pending = Math.round((currentPending - amount) * 100) / 100;
                } else {
                  // Negative balance - seller owes platform
                  seller.balance.pending = Math.round((currentPending - amount) * 100) / 100;
                }
                seller.notifications.unshift({
                  type: 'dispute',
                  from: transaction.buyer,
                  listing: transaction.listing,
                  transaction: transaction._id,
                  message: `Chargeback lost. The sale amount has been deducted from your balance.`,
                });
                await seller.save();
              }
            }
          }
          
          transaction.disputeInfo.status = dispute.status;
          await transaction.save();
        }
        break;
      }

      case 'charge.dispute.closed': {
        const dispute = event.data.object;
        
        console.log(`Chargeback closed: ${dispute.id}`);
        
        const transaction = await Transaction.findOne({
          'disputeInfo.stripeDisputeId': dispute.id
        });
        
        if (transaction) {
          transaction.disputeInfo.closedAt = new Date();
          await transaction.save();
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        // Find transaction by metadata
        const transaction = await Transaction.findById(paymentIntent.metadata.transactionId);
        if (transaction && transaction.status === 'paid') {
          transaction.stripePaymentIntentId = paymentIntent.id;
          await transaction.save();
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const transaction = await Transaction.findOne({
          'stripePaymentIntentId': charge.payment_intent
        });
        if (transaction) {
          transaction.status = 'refunded';
          await transaction.save();
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Webhook handler error' });
  }
});

module.exports = router;