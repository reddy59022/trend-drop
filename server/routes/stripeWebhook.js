const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const {
  verifyStripeWebhookEvent,
  isWebhookSignatureRequired,
  getWebhookSecret,
} = require('../config/payments');
const { clawbackSellerEarnings, reverseEscrowHold, debitPendingAllowNegative } = require('../utils/balances');
const { increment } = require('../utils/metrics');

// Stripe webhook endpoint - handles chargeback events
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('Stripe not configured - webhook disabled');
      return res.status(400).send('Webhook Error: Stripe not configured');
    }
    
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let event;

    // Fail-closed signature verification (see config/payments.js). A missing
    // signing secret is an infrastructure problem, so we answer 500 (Stripe
    // will retry once it's fixed); an invalid/missing signature on a request
    // with a configured secret is that request's problem → 400.
    if (isWebhookSignatureRequired() && !getWebhookSecret()) {
      console.error(
        '[WEBHOOK] STRIPE_WEBHOOK_SECRET is not configured — refusing to process events. ' +
        'Set the webhook signing secret (whsec_…) from the Stripe dashboard.'
      );
      return res.status(500).send('Webhook Error: Webhook signing secret not configured');
    }

    const verification = verifyStripeWebhookEvent(stripe, req.body, sig);
    if (!verification.verified) {
      increment('trenddrop_webhook_events_total', { event_type: 'unknown', result: 'rejected' });
      console.error('Webhook signature verification failed:', verification.reason);
      return res.status(400).send(`Webhook Error: ${verification.reason}`);
    }
    event = verification.event;
    increment('trenddrop_webhook_events_total', { event_type: event.type, result: 'received' });

    // Handle chargeback events
    switch (event.type) {
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const paymentIntentId = dispute.payment_intent;
        
        console.log(`[WEBHOOK] charge.dispute.created for payment_intent=${paymentIntentId}`);
        
        // Find the transaction by payment intent
        const transaction = await Transaction.findOne({
          'stripePaymentIntentId': paymentIntentId
        });
        
        console.log(`[WEBHOOK] found transaction:`, transaction ? transaction._id : 'NOT FOUND');
        
        if (transaction) {
          // IDEMPOTENCY: Stripe can re-deliver the same event. Only open the
          // dispute (and notify the seller) when this is a NEW dispute — a
          // duplicate delivery must not push duplicate notifications or reset
          // evidence deadlines that may already have been updated.
          const isNewDispute = !transaction.disputeInfo ||
            transaction.disputeInfo.stripeDisputeId !== dispute.id ||
            transaction.status !== 'chargeback_open';
          transaction.status = 'chargeback_open';
          transaction.disputeInfo = {
            stripeDisputeId: dispute.id,
            reason: dispute.reason,
            status: dispute.status,
            openedAt: transaction.disputeInfo?.openedAt || new Date(),
            evidenceDueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
          };
          await transaction.save();
          
          // Notify seller about the chargeback
          if (isNewDispute) {
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
          } else {
            increment('trenddrop_webhook_retries_total', { event_type: 'charge.dispute.created' });
          }
        }
        break;
      }

      case 'charge.dispute.updated': {
        const dispute = event.data.object;
        
        console.log(`[WEBHOOK] charge.dispute.updated dispute=${dispute.id} status=${dispute.status} payment_intent=${dispute.payment_intent}`);
        
        // Find transaction by stripe dispute ID
        const transaction = await Transaction.findOne({
          'disputeInfo.stripeDisputeId': dispute.id
        });
        
        console.log(`[WEBHOOK] found transaction:`, transaction ? transaction._id : 'NOT FOUND');
        
        if (transaction) {
          // If won, restore funds to seller
          if (dispute.status === 'won') {
            // IDEMPOTENCY: only credit once — Stripe re-delivers events and
            // also emits multiple 'updated' events as the dispute progresses.
            if (transaction.status !== 'chargeback_won') {
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
            }
          } else if (dispute.status === 'lost') {
            // IDEMPOTENCY: only debit once (see 'won' above).
            if (transaction.status !== 'chargeback_lost') {
              transaction.status = 'chargeback_lost';
              // Deduct from seller's balance if available
              if (transaction.paymentBreakdown?.sellerEarnings) {
                const seller = await User.findById(transaction.seller);
                if (seller) {
                  // ATOMIC (round 25): a lost dispute intentionally allows the
                  // pending balance to go negative (seller owes the platform).
                  await debitPendingAllowNegative(
                    seller._id,
                    transaction.paymentBreakdown.sellerEarnings
                  );
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
        // Only events created by OUR payment intents carry transactionId; a
        // missing/malformed id must not turn into a CastError (500 → Stripe
        // retries forever). Signature is already verified, but metadata is
        // still untrusted input — validate before touching the DB.
        const txId = paymentIntent.metadata?.transactionId;
        if (txId && mongoose.isValidObjectId(txId)) {
          // Find transaction by metadata
          const transaction = await Transaction.findById(txId);
          if (transaction && transaction.status === 'paid') {
            transaction.stripePaymentIntentId = paymentIntent.id;
            await transaction.save();
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const transaction = await Transaction.findOne({
          'stripePaymentIntentId': charge.payment_intent,
        });
        if (transaction && transaction.status !== 'refunded') {
          const wasReleased = transaction.status === 'completed'
            || transaction.payout?.status === 'completed';
          // REVENUE INTEGRITY (round 25): a refund issued outside the platform
          // (Stripe dashboard, manual support action) previously only flipped
          // the status — the seller kept their earnings, the listing stayed
          // sold, and the platform ate the full refund. Apply the same
          // accounting the internal refund paths do, idempotently (the status
          // gate above makes replays a no-op).
          transaction.status = 'refunded';
          if (transaction.payout) transaction.payout.status = 'refunded';
          if (!transaction.cancellation) {
            transaction.cancellation = {
              cancelledBy: 'system',
              reason: 'Charge refunded at payment provider',
              cancelledAt: new Date(),
              refundAmount: transaction.paymentBreakdown?.totalPaid || transaction.itemPrice || 0,
            };
          }
          await transaction.save();

          const sellerEarnings = transaction.paymentBreakdown?.sellerEarnings || 0;
          if (sellerEarnings > 0) {
            // A provider refund can arrive before OR after escrow release.
            // Reverse only the ledger that actually contains this sale's
            // earnings: pending escrow before completion, available-first
            // clawback after payout release. Using the wrong side either takes
            // unrelated seller funds or leaves the seller overpaid.
            if (wasReleased) {
              await clawbackSellerEarnings(transaction.seller, sellerEarnings);
            } else {
              await reverseEscrowHold(transaction.seller, sellerEarnings);
            }
          }
          const restoredQuantity = Number.isInteger(transaction.quantity) && transaction.quantity > 0
            ? transaction.quantity
            : 1;
          await Listing.findByIdAndUpdate(transaction.listing, {
            $inc: { quantity: restoredQuantity, quantitySold: -restoredQuantity },
            $set: { sold: false, available: true },
          }).catch((e) => console.error('charge.refunded inventory restore:', e.message));

          const seller = await User.findById(transaction.seller).catch(() => null);
          if (seller) {
            seller.notifications.unshift({
              type: 'dispute',
              listing: transaction.listing,
              transaction: transaction._id,
              message: 'The payment for one of your sales was refunded by the payment provider. The sale has been reversed.',
            });
            await seller.save();
          }
        } else if (transaction) {
          increment('trenddrop_webhook_retries_total', { event_type: 'charge.refunded' });
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    increment('trenddrop_webhook_events_total', { event_type: event?.type || 'unknown', result: 'failed' });
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Webhook handler error' });
  }
});

module.exports = router;