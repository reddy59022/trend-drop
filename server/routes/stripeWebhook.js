const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Payout = require('../models/Payout');
const Return = require('../models/Return');
const {
  verifyStripeWebhookEvent,
  isWebhookSignatureRequired,
  getWebhookSecret,
} = require('../config/payments');
const { clawbackSellerEarnings, reverseEscrowHold, sellerSaleTotal, debitSellerForChargeback } = require('../utils/balances');
const { increment } = require('../utils/metrics');
const restoreListingInventory = require('../utils/restoreListingInventory');
const { syncOrderFromTransaction } = require('./orderLifecycle');

// Transactions created by older checkout paths stored the provider intent only
// in paymentBreakdown.paymentIntentId. Webhook reconciliation must support both
// representations or provider refunds/disputes can be acknowledged while the
// local ledger remains paid.
const paymentIntentMatch = (paymentIntentId) => ({
  $or: [
    { stripePaymentIntentId: paymentIntentId },
    { 'paymentBreakdown.paymentIntentId': paymentIntentId },
  ],
});

// Apply a TERMINAL dispute outcome (won/lost) exactly once.
//
// Stripe's real lifecycle resolves a dispute through `charge.dispute.closed`
// carrying the final status (won/lost); an `updated` event with that terminal
// status is not guaranteed (the observed sequence is created → updated
// (under_review) → funds_reinstated → closed(won)). Both handlers therefore
// share this settlement, and the atomic status claim makes retries, replays and
// a closed-after-updated delivery all no-ops after the first.
//
// LEDGER: the sale's earnings are credited when the order is placed and are
// only reversed when the chargeback is LOST. A won dispute leaves the sale
// standing, so crediting the seller here would pay them twice for the same
// sale — opening a dispute never debits them.
//
// ORDER: a lost chargeback reverses the sale exactly like a provider refund, so
// the consolidated order must leave "confirmed" too. The shared order sync is
// idempotent (it only accumulates the refund while the item is still on the
// order), which lets a replay heal an order left stale by a crash.
const IN_PROGRESS_RETURN_STATUSES = [
  'pending', 'approved', 'shipped', 'in_transit', 'out_for_delivery',
  'delivered', 'received', 'disputed',
];

/** Close any live return for a transaction the buyer has charged back. */
async function closeReturnsForLostChargeback(transaction) {
  if (!transaction?._id) return;
  const refundAmount = transaction.paymentBreakdown?.totalPaid || transaction.itemPrice || 0;
  await Return.updateMany(
    { transaction: transaction._id, status: { $in: IN_PROGRESS_RETURN_STATUSES } },
    {
      $set: {
        status: 'refunded',
        refundAmount,
        closedByChargeback: true,
        chargebackClosedAt: new Date(),
      },
    },
  );
}

/** Stripe's dispute fee, in major units, from the dispute's balance transactions. */
function disputeFeeFrom(dispute) {
  const balanceTransactions = Array.isArray(dispute?.balance_transactions) ? dispute.balance_transactions : [];
  const feeMinor = balanceTransactions.reduce((sum, bt) => {
    const fee = Number(bt?.fee);
    return Number.isFinite(fee) && fee > 0 ? sum + fee : sum;
  }, 0);
  const currency = balanceTransactions.find((bt) => Number(bt?.fee) > 0)?.currency
    || dispute?.currency
    || 'usd';
  return { amount: Math.round(feeMinor) / 100, currency: String(currency).toUpperCase() };
}

async function syncOrderForLostChargeback(transaction) {
  if (!transaction) return;
  await syncOrderFromTransaction(
    transaction,
    'refunded',
    transaction.paymentBreakdown?.totalPaid || transaction.itemPrice || 0,
  );
}

async function settleDisputeOutcome(transaction, dispute) {
  if (!transaction || !['won', 'lost'].includes(dispute.status)) return false;
  const nextStatus = dispute.status === 'won' ? 'chargeback_won' : 'chargeback_lost';
  // Capture the release state BEFORE the claim overwrites the status: a
  // dispute opened after completion has status chargeback_open, but its money
  // already sits in available.
  const wasReleased = transaction.status === 'completed'
    || transaction.payout?.status === 'completed';
  const disputeFee = disputeFeeFrom(dispute);
  const claimed = await Transaction.findOneAndUpdate(
    {
      _id: transaction._id,
      status: { $nin: ['chargeback_won', 'chargeback_lost', 'refunded'] },
    },
    {
      $set: {
        status: nextStatus,
        'disputeInfo.status': dispute.status,
        ...(dispute.status === 'lost'
          ? {
              'payout.status': 'refunded',
              'disputeInfo.feeAmount': disputeFee.amount,
              'disputeInfo.feeCurrency': disputeFee.currency,
            }
          : {}),
      },
    },
    { new: true },
  );
  if (!claimed) {
    // Already terminal. A lost chargeback may still need its order healed (the
    // original delivery could have crashed after the status claim); the sync is
    // idempotent, so only the refund audit is guarded by the item presence.
    if (dispute.status === 'lost') {
      const current = await Transaction.findById(transaction._id).lean();
      if (current?.status === 'chargeback_lost') {
        // Heal rows settled before the fee was recorded, and close returns a
        // crash between the claim and the return sweep left open.
        if (disputeFee.amount > 0 && !current.disputeInfo?.feeAmount) {
          await Transaction.updateOne(
            { _id: current._id },
            { $set: { 'disputeInfo.feeAmount': disputeFee.amount, 'disputeInfo.feeCurrency': disputeFee.currency } },
          );
        }
        await closeReturnsForLostChargeback(current);
        await syncOrderForLostChargeback(current);
      }
    }
    return false;
  }

  if (dispute.status === 'lost') {
    const earnings = sellerSaleTotal(claimed.paymentBreakdown);
    if (earnings > 0) {
      // Released sales come out of available first (then pending, which may go
      // negative); escrowed sales only touch pending. Atomic per helper.
      await debitSellerForChargeback(claimed.seller, earnings, { released: wasReleased });
      await User.updateOne(
        { _id: claimed.seller },
        {
          $push: {
            notifications: {
              $each: [{
                type: 'dispute',
                from: claimed.buyer,
                listing: claimed.listing,
                transaction: claimed._id,
                message: 'Chargeback lost. The sale amount has been deducted from your balance.',
              }],
              $position: 0,
            },
          },
        },
      );
    }
    if (wasReleased) {
      // The sale was counted when its funds were released; a lost chargeback
      // reverses it. Floor at zero so historic stat drift cannot go negative.
      await User.updateOne({ _id: claimed.seller }, [
        {
          $set: {
            'stats.totalSales': {
              $max: [0, { $subtract: [{ $ifNull: ['$stats.totalSales', 0] }, 1] }],
            },
          },
        },
      ]);
    }
    await closeReturnsForLostChargeback(claimed);

    // A pending/completed payout for a lost sale must not keep showing as owed
    // or paid on the seller dashboard.
    await Payout.updateMany(
      { transaction: claimed._id, status: { $ne: 'refunded' } },
      { $set: { status: 'refunded', refundedAt: new Date() } },
    );
    if (claimed.escrow && ['active', 'disputed'].includes(claimed.escrow.status)) {
      await Transaction.updateOne(
        { _id: claimed._id },
        { $set: { 'escrow.status': 'resolved', 'escrow.resolution': 'chargeback_lost', 'escrow.resolvedAt': new Date() } },
      );
    }
    await syncOrderForLostChargeback(claimed);
  } else {
    await User.updateOne(
      { _id: claimed.seller },
      {
        $push: {
          notifications: {
            $each: [{
              type: 'dispute',
              from: claimed.buyer,
              listing: claimed.listing,
              transaction: claimed._id,
              message: 'Chargeback resolved in your favor. The sale stands.',
            }],
            $position: 0,
          },
        },
      },
    );
  }
  return true;
}

// Stripe webhook endpoint - handles chargeback events
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  // Declared OUTSIDE the try: `let` is block-scoped, so the catch block could
  // not read the verified event and threw a ReferenceError of its own — the
  // request never answered, so Stripe never saw the 5xx it retries on.
  let event = null;
  try {
    const sig = req.headers['stripe-signature'];
    
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('Stripe not configured - webhook disabled');
      return res.status(400).send('Webhook Error: Stripe not configured');
    }
    
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
        const transaction = await Transaction.findOne(paymentIntentMatch(paymentIntentId));
        
        console.log(`[WEBHOOK] found transaction:`, transaction ? transaction._id : 'NOT FOUND');
        
        if (transaction) {
          // A late/replayed `created` event must never reopen a dispute that
          // already reached a terminal resolution. Doing so reset the status
          // to chargeback_open, which let a subsequent (also replayed) `won`
          // event credit the seller a second time.
          const sameDispute = transaction.disputeInfo?.stripeDisputeId === dispute.id;
          const alreadyResolved = sameDispute &&
            (['chargeback_won', 'chargeback_lost'].includes(transaction.status) ||
              ['won', 'lost'].includes(transaction.disputeInfo?.status));
          if (alreadyResolved) {
            increment('trenddrop_webhook_retries_total', { event_type: 'charge.dispute.created' });
            break;
          }

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
          // Ignore an out-of-order terminal update from the same dispute. A
          // replayed `lost` after `won` (or vice versa) must not move money a
          // second time; Stripe's terminal dispute result does not flip back.
          const sameDispute = transaction.disputeInfo?.stripeDisputeId === dispute.id;
          const priorStatus = transaction.disputeInfo?.status;
          const priorTerminal = ['won', 'lost'].includes(priorStatus) ||
            ['chargeback_won', 'chargeback_lost'].includes(transaction.status);
          if (sameDispute && priorTerminal && priorStatus !== dispute.status) {
            increment('trenddrop_webhook_retries_total', { event_type: 'charge.dispute.updated' });
            break;
          }

          if (['won', 'lost'].includes(dispute.status)) {
            const settled = await settleDisputeOutcome(transaction, dispute);
            if (!settled) {
              increment('trenddrop_webhook_retries_total', { event_type: 'charge.dispute.updated' });
            }
          } else {
            // Progress update only (needs_response / under_review). Atomic so a
            // stale transaction document can never roll back a terminal status
            // applied by a concurrent closed event.
            await Transaction.updateOne(
              { _id: transaction._id },
              { $set: { 'disputeInfo.status': dispute.status } },
            );
          }
        }
        break;
      }

      case 'charge.dispute.closed': {
        const dispute = event.data.object;
        
        console.log(`Chargeback closed: ${dispute.id} status=${dispute.status}`);
        
        const transaction = await Transaction.findOne({
          'disputeInfo.stripeDisputeId': dispute.id
        });
        
        if (transaction) {
          // Stripe's real resolution path ends here: the closed event carries
          // the final won/lost outcome, so the ledger and order status must be
          // settled from it too (idempotent with any earlier updated event).
          if (['won', 'lost'].includes(dispute.status)) {
            const settled = await settleDisputeOutcome(transaction, dispute);
            if (!settled) {
              increment('trenddrop_webhook_retries_total', { event_type: 'charge.dispute.closed' });
            }
          } else {
            await Transaction.updateOne(
              { _id: transaction._id },
              { $set: { 'disputeInfo.status': dispute.status } },
            );
          }
          await Transaction.updateOne(
            { _id: transaction._id },
            { $set: { 'disputeInfo.closedAt': transaction.disputeInfo?.closedAt || new Date() } },
          );
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
        let transaction = null;
        if (txId && mongoose.isValidObjectId(txId)) {
          // Prefer the authenticated transaction binding when present.
          transaction = await Transaction.findOne({ _id: txId, status: 'paid' });
        }
        // Older checkout paths did not include transactionId metadata, but did
        // persist the intent in paymentBreakdown.paymentIntentId. Reconcile by
        // provider ID as a safe fallback rather than silently acknowledging the
        // event with an unlinked paid transaction.
        if (!transaction && paymentIntent.id) {
          transaction = await Transaction.findOne({
            ...paymentIntentMatch(paymentIntent.id),
            status: 'paid',
          });
        }
        if (transaction) {
          transaction.stripePaymentIntentId = paymentIntent.id;
          await transaction.save();
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        let transaction = await Transaction.findOne(paymentIntentMatch(charge.payment_intent));

        // Internal cancellation/auto-cancel already refunded the buyer,
        // clawed back the seller ledger, and restored inventory. The Stripe
        // `charge.refunded` event follows that refund; treating it as a new
        // refund restores stock twice and debits unrelated seller funds.
        const alreadyUnwound = Boolean(transaction && (
          (transaction.cancellation?.cancelledAt || transaction.cancellation?.cancelledBy) ||
          transaction.status === 'refunded' ||
          ['cancelled_by_buyer', 'cancelled_by_seller', 'auto_cancelled'].includes(transaction.status) ||
          transaction.payout?.status === 'refunded'
        ));
        if (alreadyUnwound) {
          // The transaction was already unwound by an internal path, but the
          // consolidated Order may not have been synced (a crash between the
          // claim and the order save, or a legacy row). Re-syncing is
          // idempotent, so a provider retry heals the order without moving any
          // money a second time.
          if (transaction) {
            await syncOrderFromTransaction(
              transaction,
              'refunded',
              transaction.cancellation?.refundAmount
                || transaction.paymentBreakdown?.totalPaid
                || transaction.itemPrice
                || 0,
            );
          }
          increment('trenddrop_webhook_retries_total', { event_type: 'charge.refunded' });
          break;
        }

        if (transaction && transaction.status !== 'refunded') {
          const wasReleased = transaction.status === 'completed'
            || transaction.payout?.status === 'completed';
          // Claim the reconciliation atomically before touching balances or
          // inventory. Stripe retries can arrive concurrently; a read-then-
          // save status check lets both deliveries reverse the same sale.
          const claimed = await Transaction.findOneAndUpdate(
            { _id: transaction._id, status: { $ne: 'refunded' } },
            { $set: { status: 'refunded', 'payout.status': 'refunded' } },
            { new: true }
          );
          if (!claimed) {
            increment('trenddrop_webhook_retries_total', { event_type: 'charge.refunded' });
            break;
          }
          transaction = claimed;
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

          // Keep the consolidated Order in sync: the buyer's order must not
          // stay "confirmed" after the payment provider refunded its item.
          await syncOrderFromTransaction(
            transaction,
            'refunded',
            transaction.cancellation?.refundAmount
              || transaction.paymentBreakdown?.totalPaid
              || transaction.itemPrice
              || 0,
          );

          const sellerEarnings = sellerSaleTotal(transaction.paymentBreakdown);
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
          await restoreListingInventory(transaction.listing, {
            quantity: restoredQuantity,
            quantitySold: -restoredQuantity,
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