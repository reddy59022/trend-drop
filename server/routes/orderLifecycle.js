const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Payout = require('../models/Payout');
const Order = require('../models/Order');
const { carriers, normalizeCarrier } = require('../config/shipping');
const { orderStates, allowedTransitions, timeWindows, cancellationRules, refundRules, returnEligibility, evidenceRequirements, disputeProcess, isValidTransition, getAllowedActions } = require('../config/orderLifecycle');
const { calculatePaymentBreakdown, capturePaymentIntent, retrievePaymentIntent, issueRefund } = require('../config/payments');
const { releaseSellerEarnings, settlementAlreadyApplied, clawbackSellerEarnings } = require('../utils/balances');
const { claimTransaction } = require('../utils/claims');
const { isValidObjectId } = require('../utils/validators');
// Viewer-aware transaction shaping (seller earnings column + boost privacy).
const { sanitizeTransactionForViewer } = require('../utils/transactionView');

// ============================================================
// ITEM-LEVEL BOOST FEE LEDGER (reversal/collection)
// The boost fee is tracked on the LISTING that generated it.
//   sale        → boost.feeLedger.owed  += fee   (in transactions/payments)
//   completed   → boost.feeLedger.owed  -= fee;  collected += fee
//   cancelled/  → boost.feeLedger.owed  -= fee;  reversed  += fee
//   returned/refunded
// Idempotent: only reverses if `owed` has the fee (guards double-run).
// ============================================================
const reverseBoostFeeOwed = async (listingId, boostFee) => {
  if (!boostFee || boostFee <= 0) return null;
  const fee = Math.round(boostFee * 100) / 100;
  // Only reverse what is actually owed (never goes negative)
  return Listing.findOneAndUpdate(
    { _id: listingId, 'boost.feeLedger.owed': { $gte: fee } },
    {
      $inc: { 'boost.feeLedger.owed': -fee, 'boost.feeLedger.reversed': fee },
    },
    { new: true }
  );
};

const collectBoostFeeOwed = async (listingId, boostFee) => {
  if (!boostFee || boostFee <= 0) return null;
  const fee = Math.round(boostFee * 100) / 100;
  // Only collect what is actually owed (never goes negative)
  return Listing.findOneAndUpdate(
    { _id: listingId, 'boost.feeLedger.owed': { $gte: fee } },
    {
      $inc: { 'boost.feeLedger.owed': -fee, 'boost.feeLedger.collected': fee },
    },
    { new: true }
  );
};

// ROLLBACK SAFETY: any time money reverts to the buyer, also
// (1) reverse the listing-level boost fee, and
// (2) mark the payout refunded so auto-complete can never release it.
const markPayoutRefunded = async (txn) => {
  try {
    await Payout.updateMany(
      { transaction: txn._id, status: { $ne: 'refunded' } },
      { $set: { status: 'refunded', refundedAt: new Date() } }
    );
  } catch (e) { console.error('Failed to mark payout refunded:', e.message); }
};

// ============================================================
// CRITICAL: Every state change is validated against the state machine.
// No manual status updates allowed - only system transitions.
// Money moves in this specific order:
//   capture → label → transaction → inventory → balances
// ============================================================

// ============================================================
// ENTERPRISE ORDER ENDPOINTS (one order = one buyer checkout,
// possibly multiple sellers, each with its own shipment)
// ============================================================

// ============================================================
// Shared helper: when a transaction underneath an Enterprise Order
// is cancelled/refunded/completed, keep the consolidated Order in sync.
// If ALL shipments are refunded → Order = 'refunded' + payment refunded
// + cancellation audit trail. Shipments left with zero items are marked
// 'cancelled' so they never look outstanding.
// ============================================================
const syncOrderFromTransaction = async (txn, newStatus, refundAmount = 0) => {
  try {
    const orders = await Order.find({ 'items.transaction': txn._id });
    for (const order of orders) {
      let touched = false;

      if (newStatus === 'refunded') {
        // Remove the refunded txn from any shipment it belongs to; a
        // shipment left with no items is fully cancelled → mark it so.
        (order.shipments || []).forEach((s) => {
          const idx = (s.items || []).findIndex((id) => id && id.toString() === txn._id.toString());
          if (idx >= 0) { s.items.splice(idx, 1); touched = true; }
          if ((s.items || []).length === 0 && s.status !== 'cancelled') {
            s.status = 'cancelled';
            touched = true;
          }
        });
        // Remove the refunded item from the consolidated items list
        const before = order.items.length;
        order.items = (order.items || []).filter((it) => !(it.transaction && it.transaction.toString() === txn._id.toString()));
        if (order.items.length !== before) touched = true;

        // Accumulate the cancellation audit trail on the consolidated order
        // (running total — equals the full captured amount once every item
        // of the order has been refunded).
        if (!order.cancellation) order.cancellation = {};
        order.cancellation.cancelledBy = txn.cancellation?.cancelledBy || 'buyer';
        order.cancellation.reason = txn.cancellation?.reason || order.cancellation.reason || null;
        order.cancellation.cancelledAt = txn.cancellation?.cancelledAt || new Date();
        order.cancellation.currency = txn.currency || order.currency || 'USD';
        order.cancellation.refundAmount = Math.round(((order.cancellation.refundAmount || 0) + (refundAmount || 0)) * 100) / 100;
        touched = true;

        // If EVERY shipment + item is refunded → final state
        const anyRemaining = (order.shipments || []).some((s) => s.items.length > 0) || order.items.length > 0;
        if (!anyRemaining) {
          order.status = 'refunded';
          if (order.payment) order.payment.status = 'refunded';
        }
      } else if (newStatus === 'completed') {
        // Mark the Order completed ONLY when EVERY underlying transaction completed
        const txnIds = (order.items || []).map((it) => it.transaction).filter(Boolean);
        if (txnIds.length > 0) {
          const remaining = await Transaction.countDocuments({ _id: { $in: txnIds }, status: { $nin: ['completed'] } });
          if (remaining === 0) {
            order.status = 'completed';
            if (order.payment) order.payment.status = 'captured';
            touched = true;
          }
        }
      }

      if (touched) await order.save();
    }
  } catch (e) {
    console.error('syncOrderFromTransaction failed:', e.message);
  }
};

// GET /api/orders - list orders for current user with role + allowed actions
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const orders = await Order.find({ $or: [{ buyer: req.user._id }, { sellers: req.user._id }] })
      .populate('items.listing', 'title images price currency brand condition size')
      .populate('items.transaction')
      .populate('buyer', 'name avatar email')
      .populate('sellers', 'name avatar')
      .sort({ createdAt: -1 });

    const enriched = orders.map((o) => {
      const isBuyer = o.buyer._id.toString() === userId;
      const role = isBuyer ? 'buyer' : 'seller';
      const raw = o.toObject();
      // G5 FIX: materialize the totalAmount virtual so the API never returns NaN
      return {
        ...raw,
        // Embedded transactions follow the same viewer rule as /api/transactions:
        // a seller sees their boost fee + reconciled column, a buyer sees neither.
        items: (raw.items || []).map((item) => ({
          ...item,
          transaction: item.transaction ? sanitizeTransactionForViewer(item.transaction, userId) : item.transaction,
        })),
        totalAmount: raw.totals && typeof raw.totals.total === 'number' ? raw.totals.total : 0,
        role,
        allowedActions: Order.getAllowedOrderActions(o, role, userId),
      };
    });

    res.json({ orders: enriched });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/orders/:id - single consolidated order (buyer or participating seller)
router.get('/:id', auth, async (req, res) => {
  try {
    // Hostile-input guard: a truthy-but-uncastable id ("undefined", "123", {})
    // used to reach findById() and throw a CastError -> 500. Round 22/23
    // convention: validate BEFORE querying and answer 404.
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Order not found' });
    }
    const order = await Order.findById(req.params.id)
      .populate('items.listing', 'title images price currency brand condition size')
      .populate('items.transaction')
      .populate('buyer', 'name avatar email')
      .populate('sellers', 'name avatar');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    const userId = req.user._id.toString();
    const isBuyer = order.buyer._id.toString() === userId;
    const isSeller = (order.sellers || []).some((s) => s._id.toString() === userId);
    if (!isBuyer && !isSeller) {
      return res.status(403).json({ message: 'Not authorized to view this order' });
    }

    const role = isBuyer ? 'buyer' : 'seller';
    const raw = order.toObject();
    const payload = {
      ...raw,
      // Same viewer rule as the transaction endpoints (boost fee is seller-only).
      items: (raw.items || []).map((item) => ({
        ...item,
        transaction: item.transaction ? sanitizeTransactionForViewer(item.transaction, userId) : item.transaction,
      })),
      totalAmount: raw.totals && typeof raw.totals.total === 'number' ? raw.totals.total : 0,
      role,
      allowedActions: Order.getAllowedOrderActions(order, role, userId),
      payment: raw.payment || {},
    };

    res.json({ order: payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/orders/:id/ship - seller marks ONLY their own shipment as shipped
router.post('/:id/ship', auth, async (req, res) => {
  try {
    const { shipmentIndex, trackingNumber, carrier } = req.body;
    if (shipmentIndex === undefined) {
      return res.status(400).json({ message: 'shipmentIndex is required' });
    }
    
    if (trackingNumber !== undefined && (typeof trackingNumber !== 'string' || trackingNumber.trim().length < 3 || trackingNumber.length > 64)) {
      return res.status(400).json({ message: 'trackingNumber must be a string between 3 and 64 characters' });
    }
    const requestedCarrier = carrier === undefined ? undefined : normalizeCarrier(carrier);
    if (carrier !== undefined && !requestedCarrier) {
      return res.status(400).json({ message: 'Unsupported carrier' });
    }

    // Validate orderId
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const shipment = order.shipments[shipmentIndex];
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    // A seller may only ship their own items
    if (shipment.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to ship this seller\'s items' });
    }

    if (['shipped', 'in_transit', 'delivered', 'confirmed'].includes(shipment.status)) {
      return res.status(400).json({ message: 'Shipment already shipped' });
    }

    // A shipment whose items were all refunded/cancelled has nothing to ship.
    if (shipment.status === 'cancelled' || !(shipment.items || []).length) {
      return res.status(400).json({ message: 'Shipment was cancelled — nothing to ship' });
    }

    shipment.status = 'shipped';
    if (trackingNumber) shipment.trackingNumber = trackingNumber;
    if (requestedCarrier) shipment.carrier = requestedCarrier;
    shipment.shippedAt = new Date();
    await order.save();

    // RACE-SAFETY: only transition transactions that are still eligible for
    // dispatch ('paid'/'processing'). A transaction claimed by an in-flight
    // or completed cancellation must NEVER be stomped back to 'shipped' —
    // that would ship an order whose money was already refunded to the buyer.
    let shippedCount = 0;
    try {
      const syncRes = await Transaction.updateMany(
        { _id: { $in: shipment.items }, status: { $in: ['paid', 'processing'] } },
        {
          $set: {
            status: 'shipped',
            'shipping.trackingNumber': trackingNumber || '',
            'shipping.carrier': requestedCarrier || '',
          },
        }
      );
      shippedCount = syncRes.modifiedCount ?? syncRes.nModified ?? 0;
      const cancelGuard = await Transaction.countDocuments({
        _id: { $in: shipment.items },
        status: { $in: ['cancelled', 'cancelled_by_buyer', 'cancelled_by_seller', 'auto_cancelled', 'refunded'] },
      });
      if (cancelGuard > 0) {

        // Another party cancelled (part of) this shipment while we were
        // shipping — refuse the dispatch so money and goods never diverge.
        if (shippedCount > 0) {
          await Transaction.updateMany(
            { _id: { $in: shipment.items }, status: 'shipped', 'shipping.trackingNumber': trackingNumber || '' },
            { $set: { status: 'paid' } }
          );
        }
        // The order document was touched before the guarded transaction
        // update. Roll that shipment mutation back as well, otherwise the UI
        // would report a dispatched parcel after the money was refunded.
        shipment.status = 'cancelled';
        shipment.shippedAt = null;
        shipment.trackingNumber = '';
        shipment.carrier = '';
        await order.save();
        return res.status(409).json({
          message: 'This shipment was cancelled while dispatching. Order not shipped.',
        });
      }
    } catch (syncErr) {
      console.error('Transaction sync error:', syncErr.message);
    }

    const userId = req.user._id.toString();
    const role = order.buyer.toString() === userId ? 'buyer' : 'seller';
    const raw = order.toObject();
    const payload = {
      ...raw,
      // Seller-only endpoint, so this payload carries the reconciled earnings
      // column; the raw boost ledger fields are shaped by the same helper.
      items: (raw.items || []).map((item) => ({
        ...item,
        transaction: item.transaction ? sanitizeTransactionForViewer(item.transaction, userId) : item.transaction,
      })),
      totalAmount: raw.totals && typeof raw.totals.total === 'number' ? raw.totals.total : 0,
      role,
      allowedActions: Order.getAllowedOrderActions(order, role, userId),
    };

    res.json({ message: 'Shipment marked as shipped', order: payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Middleware: Validate order access and state machine transition
const validateOrderAccess = async (req, res, next) => {
  try {
    const transactionId = req.params.transactionId || req.body.transactionId;
    if (!isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'Invalid transaction ID' });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    const userId = req.user._id.toString();
    if (transaction.buyer.toString() === userId) {
      req.orderRole = 'buyer';
    } else if (transaction.seller.toString() === userId) {
      req.orderRole = 'seller';
    } else {
      return res.status(403).json({ message: 'Not authorized' });
    }
    req.transaction = transaction;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================================
// GET /api/orders/:transactionId/status
// ============================================================
router.get('/:transactionId/status', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;
    const role = req.orderRole;
    const now = Date.now();
    const deliveredAt = txn.shipping?.actualDelivery || (txn.status === 'delivered' ? txn.updatedAt : null);
    // Viewer-aware money view (buyers never see the seller's boost fee).
    const txnView = sanitizeTransactionForViewer(txn, req.user._id);
    const returnWindowEnd = deliveredAt ? new Date(deliveredAt).getTime() + timeWindows.RETURN_WINDOW : null;
    const canReturn = returnWindowEnd && now <= returnWindowEnd;
    const isAutoCompletable = txn.status === orderStates.BUYER_CONFIRMED &&
      (now - new Date(txn.updatedAt).getTime()) >= timeWindows.AUTO_COMPLETE;

    res.json({
      status: txn.status,
      allowedActions: getAllowedActions(txn.status, role),
      timeline: {
        createdAt: txn.createdAt,
        paidAt: txn.createdAt,
        shippedAt: txn.shipping?.labelCreatedDate,
        deliveredAt: txn.shipping?.actualDelivery,
        confirmedAt: txn.buyerConfirmed?.confirmedAt,
      },
      eligibility: {
        canCancel: isValidTransition(txn.status, role === 'buyer' ? orderStates.CANCELLED_BY_BUYER : orderStates.CANCELLED_BY_SELLER),
        canReturn,
        returnWindowEnd: returnWindowEnd ? new Date(returnWindowEnd).toISOString() : null,
        canFileDispute: isValidTransition(txn.status, orderStates.DISPUTED),
        isAutoCompletable,
      },
      payment: txnView.paymentBreakdown,
      // Seller-only: the reconciled earnings column behind "What You Earned".
      ...(txnView.sellerBreakdown ? { sellerBreakdown: txnView.sellerBreakdown } : {}),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/orders/:transactionId/cancel
// CRITICAL: Validates state machine transition before touching money.
//
// ENTERPRISE IMMEDIATE-CANCELLATION CONTRACT (zero-sum, exactly-once):
//   1. ATOMIC CLAIM — the pre-shipment → cancelled transition is claimed
//      with a guarded findOneAndUpdate, so concurrent double-clicks /
//      racing requests can NEVER double-refund or double-restore inventory.
//      A losing request is answered idempotently (200 alreadyCancelled)
//      with zero side effects.
//   2. STRIPE REFUND FIRST — full amount (item + shipping + protection)
//      back to the buyer's original payment method. On Stripe failure the
//      claim is reverted and NOTHING is moved (502, retryable).
//   3. LEDGER UNWIND — seller pending clawback (exact credited amount,
//      net of boost fee), buyer + seller notifications, inventory restore
//      (exact quantity), boost-fee reversal, payouts → refunded.
//   4. ORDER SYNC — consolidated Order → refunded + payment refunded +
//      emptied shipment 'cancelled' + cancellation audit trail.
//
// Money: capture → [cancel] → refund to buyer; seller pending clawed back;
// nobody gains, nobody loses.
// ============================================================
router.post('/:transactionId/cancel', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn0 = req.transaction;
    const role = req.orderRole;
    const { reason, evidence } = req.body;

    const cancelState = role === 'buyer' ? orderStates.CANCELLED_BY_BUYER : orderStates.CANCELLED_BY_SELLER;

    // Pre-shipment eligible states per role (mirrors the state machine):
    //   buyer  → 'paid'      (processing = seller preparing, buyer locked out)
    //   seller → 'paid' | 'processing'
    const eligibleFrom = role === 'buyer' ? [orderStates.PAID] : [orderStates.PAID, orderStates.PROCESSING];

    // IDEMPOTENT ACK: the order is already cancelled/refunded. Never re-run
    // side effects (no double refund, no double inventory restore). This MUST
    // be checked before the state-machine guard so a retried/double-clicked
    // cancel is answered cleanly instead of as a transition error.
    const terminalCancelStates = [
      orderStates.CANCELLED_BY_BUYER, orderStates.CANCELLED_BY_SELLER,
      orderStates.AUTO_CANCELLED, orderStates.REFUNDED,
    ];
    if (terminalCancelStates.includes(txn0.status)) {
      return res.json({
        message: 'Order was already cancelled and refunded.',
        transaction: txn0,
        alreadyCancelled: true,
        refundAmount: txn0.cancellation?.refundAmount ?? 0,
        refundType: 'full',
      });
    }

    // State machine validation - CRITICAL safety check (clear error surface)
    if (!isValidTransition(txn0.status, cancelState)) {
      return res.status(400).json({
        message: `Cannot cancel from '${txn0.status}'. ${cancellationRules[role]?.afterShipment?.reason || ''}`
      });
    }

    // Only allow cancellation before shipment
    if (!eligibleFrom.includes(txn0.status)) {
      return res.status(400).json({ message: cancellationRules[role].afterShipment?.reason || 'Cannot cancel after shipment' });
    }

    // ---- STEP 1: ATOMIC CLAIM (exactly-once side effects) ----------------
    const claimed = await Transaction.findOneAndUpdate(
      { _id: txn0._id, status: { $in: eligibleFrom } },
      { $set: { status: cancelState } },
      { new: false } // returns the PRE-claim document (original status)
    );

    if (!claimed) {
      // We lost the race — someone else transitioned the transaction.
      const fresh = await Transaction.findById(txn0._id);
      const terminalCancelStates = [
        orderStates.CANCELLED_BY_BUYER, orderStates.CANCELLED_BY_SELLER, orderStates.REFUNDED,
      ];
      if (fresh && terminalCancelStates.includes(fresh.status)) {
        // Idempotent ack: the order is already cancelled & refunded. NEVER
        // re-run side effects (no double refund, no double restore).
        return res.json({
          message: 'Order was already cancelled and refunded.',
          transaction: fresh,
          alreadyCancelled: true,
          refundAmount: fresh.cancellation?.refundAmount ?? 0,
          refundType: 'full',
        });
      }
      return res.status(400).json({
        message: `Cannot cancel from '${fresh?.status || 'unknown'}'. ${cancellationRules[role]?.afterShipment?.reason || ''}`
      });
    }

    const originalStatus = claimed.status; // pre-claim state (for revert)
    claimed.status = cancelState;          // align memory with the claimed DB state

    // ---- STEP 2: FULL REFUND TO THE BUYER (original payment method) ------
    const paymentIntentId = claimed.payout?.transactionId;
    const refundAmount = Math.round((claimed.paymentBreakdown?.totalPaid || 0) * 100) / 100;
    let stripeRefundResult = null;
    try {
      const { retrievePaymentIntent, releaseAuthorization, issueRefund } = require('../config/payments');
      if (paymentIntentId) {
        const pi = await retrievePaymentIntent(paymentIntentId);
        if (pi.status === 'requires_capture') {
          // Payment only authorized (not yet captured) — release the hold.
          stripeRefundResult = await releaseAuthorization(paymentIntentId);
        } else {
          // Payment captured — issue a FULL refund.
          stripeRefundResult = await issueRefund(paymentIntentId, refundAmount);
        }
        if (stripeRefundResult && stripeRefundResult.status && !['succeeded', 'pending', 'cancelled', 'canceled'].includes(stripeRefundResult.status)) {
          throw new Error(`Stripe refund not accepted (status: ${stripeRefundResult.status})`);
        }
      } else {
        // No payment intent recorded — nothing to reverse at Stripe, but the
        // order must still unwind. Record it so finance can audit.
        stripeRefundResult = { status: 'skipped', reason: 'no_payment_intent' };
      }
    } catch (stripeErr) {
      // COMPENSATING ACTION: nothing has moved in our ledger yet — revert
      // the atomic claim so the buyer can retry the cancellation cleanly.
      console.error('Stripe refund/release failed, reverting cancel claim:', stripeErr.message);
      await Transaction.updateOne(
        { _id: txn0._id, status: cancelState },
        {
          $set: {
            status: originalStatus,
            'cancellation.cancelledBy': claimed.cancellation?.cancelledBy ?? null,
            'cancellation.reason': claimed.cancellation?.reason ?? null,
            'cancellation.cancelledAt': claimed.cancellation?.cancelledAt ?? null,
            'cancellation.refundAmount': claimed.cancellation?.refundAmount ?? null,
          },
        }
      );
      return res.status(502).json({
        message: 'Refund could not be processed right now. The order was NOT cancelled — please try again.',
      });
    }

    // ---- STEP 3: LEDGER UNWIND (no gain, no loss for anyone) -------------
    const clawback = Math.round((claimed.paymentBreakdown?.sellerEarnings || 0) * 100) / 100;

    // 3a. Seller: claw back the EXACT amount credited at checkout (already
    //     net of any boost fee — parity with payments.js). Never negative.
    //     ATOMIC (round 25): pending is decremented in one $inc-style pipeline
    //     update with a server-side floor, so a concurrent completion/refund
    //     can't lose the clawback.
    const seller = await User.findById(claimed.seller);
    if (seller) {
      await User.updateOne({ _id: seller._id }, [
        { $set: { 'balance.pending': { $max: [0, { $subtract: [{ $ifNull: ['$balance.pending', 0] }, clawback] }] } } },
      ]);
      if (role === 'seller') {
        seller.stats.strikes = (seller.stats.strikes || 0) + 1;
        seller.notifications.unshift({
          type: 'sale',
          listing: claimed.listing,
          transaction: claimed._id,
          message: `Order cancelled by you. Strike ${seller.stats.strikes}/3 before suspension.`,
        });
      } else {
        seller.notifications.unshift({
          type: 'sale',
          listing: claimed.listing,
          transaction: claimed._id,
          message: `Order cancelled by the buyer before shipment. ${refundAmount} ${claimed.currency} fully refunded. Your pending earnings were reversed.`,
        });
      }
      await seller.save();
    }

    // 3b. Buyer: confirm the refund (original payment method)
    const buyer = await User.findById(claimed.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'refund',
        listing: claimed.listing,
        transaction: claimed._id,
        message: `Order cancelled. Full refund of ${refundAmount} ${claimed.currency} has been processed to your original payment method.`,
      });
      await buyer.save();
    }

    // 3c. Inventory: restore the EXACT quantity bought (zero-leakage).
    const restoredQty = claimed.quantity || 1;
    await Listing.findByIdAndUpdate(claimed.listing, {
      $inc: { quantity: restoredQty, quantitySold: -restoredQty },
      $set: { sold: false, available: true },
    });

    // 3d. Boost fee is never charged for a cancelled order (idempotent reversal).
    await reverseBoostFeeOwed(claimed.listing, claimed.paymentBreakdown?.boostFee || 0);

    // 3e. Payout records → refunded so auto-complete/cron can never release
    //     funds for a cancelled order; also flag the transaction payout.
    await markPayoutRefunded(claimed);

    // ---- STEP 4: FINALIZE TRANSACTION + CONSOLIDATED ORDER ---------------
    claimed.payout.status = 'refunded';
    claimed.cancellation = {
      cancelledBy: role,
      reason: reason || evidence || `Cancelled by ${role}`,
      cancelledAt: new Date(),
      refundAmount,
    };
    await claimed.save();

    // Keep the consolidated Enterprise Order in sync (full refund → refunded)
    await syncOrderFromTransaction(claimed, 'refunded', refundAmount);

    res.json({
      message: `Order cancelled. Full refund of ${refundAmount} ${claimed.currency} has been processed to your original payment method.`,
      transaction: claimed,
      refundAmount,
      refundType: 'full',
      stripeRefund: stripeRefundResult,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/orders/:transactionId/confirm-received
// Moves order from delivered/completed → buyer_confirmed
// Funds NOT released yet - they stay pending until auto-complete
// ============================================================
router.post('/:transactionId/confirm-received', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'buyer') {
      return res.status(403).json({ message: 'Only buyer can confirm receipt' });
    }

    if (!isValidTransition(txn.status, orderStates.BUYER_CONFIRMED)) {
      return res.status(400).json({ message: `Cannot confirm receipt from '${txn.status}'. Must be delivered.` });
    }

    const { packingProof } = req.body;

    txn.status = orderStates.BUYER_CONFIRMED;
    txn.buyerConfirmed = {
      received: true,
      confirmedAt: new Date(),
      packingProof: packingProof || [],
    };

    // Notify seller
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: 'Buyer confirmed receipt! Payment will be released in 3 days unless a return is requested.',
      });
      await seller.save();
    }

    await txn.save();

    res.json({
      message: 'Receipt confirmed. Payment will be released in 3 days.',
      transaction: txn,
      releaseDate: new Date(Date.now() + timeWindows.AUTO_COMPLETE).toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/orders/:transactionId/auto-complete
// SYSTEM ONLY: Called by auto-track cron or admin
// Releases funds: seller balance.pending → available
// CRITICAL: Only valid from buyer_confirmed after 3 days
// ============================================================
router.post('/:transactionId/auto-complete', auth, validateOrderAccess, async (req, res) => {
  // Declared OUTSIDE the try: `let` is block-scoped, so a declaration inside
  // the try is invisible to the catch. The catch must be able to release the
  // completion claim, otherwise a failed release strands the order forever.
  let txn;
  try {
    txn = req.transaction;

    if (!isValidTransition(txn.status, orderStates.COMPLETED)) {
      return res.status(400).json({ message: `Cannot complete from '${txn.status}'` });
    }

    // CRITICAL FIX #1: Verify BOTH conditions are met:
    // 1. 3 days have passed since buyer confirmed (return window for buyer)
    // 2. 5 days have passed since delivery (return window protection)
    const confirmedAt = txn.buyerConfirmed?.confirmedAt || txn.updatedAt;
    const deliveredAt = txn.shipping?.actualDelivery || txn.shipping?.labelCreatedDate || txn.createdAt;
    
    const timeSinceConfirm = Date.now() - new Date(confirmedAt).getTime();
    const timeSinceDelivery = Date.now() - new Date(deliveredAt).getTime();
    
    // Check 3-day wait after confirmation
    if (timeSinceConfirm < timeWindows.AUTO_COMPLETE) {
      const remaining = Math.ceil((timeWindows.AUTO_COMPLETE - timeSinceConfirm) / (1000 * 60 * 60));
      return res.status(400).json({
        message: `Cannot complete yet. ${remaining} hours remaining after confirmation.`,
        releaseDate: new Date(new Date(confirmedAt).getTime() + timeWindows.AUTO_COMPLETE).toISOString(),
      });
    }
    
    // CRITICAL: Check 5-day return window from delivery has expired
    if (timeSinceDelivery < timeWindows.PAYOUT_HOLD_FROM_DELIVERY) {
      const remaining = Math.ceil((timeWindows.PAYOUT_HOLD_FROM_DELIVERY - timeSinceDelivery) / (1000 * 60 * 60));
      return res.status(400).json({
        message: `Cannot complete yet. Return window still active. ${remaining} hours remaining from delivery.`,
        releaseDate: new Date(new Date(deliveredAt).getTime() + timeWindows.PAYOUT_HOLD_FROM_DELIVERY).toISOString(),
        reason: 'return_window_protection',
      });
    }

    const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;

    // CRITICAL FIX #2 & #3: Apply seller reserve and new seller hold
    const seller = await User.findById(txn.seller);
    // A completed sale without a valid seller account would capture the buyer's
    // money and finalize the transaction without crediting anyone. Fail closed
    // before claiming or mutating any money state so finance can repair the
    // orphaned record and retry safely.
    if (!seller) {
      return res.status(409).json({ message: 'Seller account is unavailable; funds were not released. Please retry after repair.' });
    }
    // True once the funds for this order are demonstrably with the seller —
    // either because this attempt released them or because an earlier attempt
    // already did. Every payout-side effect below is gated on it so a retry
    // completes the order without paying for it twice.
    let settlementApplied = true;
    {
      // FIX #3: New seller hold - first 5 sales held 14 days
      const isNewSeller = (seller.stats.totalSales || 0) < timeWindows.NEW_SELLER_THRESHOLD;
      if (isNewSeller) {
        const accountAge = Date.now() - new Date(seller.createdAt).getTime();
        if (accountAge < timeWindows.NEW_SELLER_HOLD) {
          const remaining = Math.ceil((timeWindows.NEW_SELLER_HOLD - accountAge) / (1000 * 60 * 60 * 24));
          return res.status(400).json({
            message: `New seller hold active. ${remaining} days remaining before funds release.`,
            releaseDate: new Date(new Date(seller.createdAt).getTime() + timeWindows.NEW_SELLER_HOLD).toISOString(),
            reason: 'new_seller_hold',
          });
        }
      }

      // Claim completion exactly once after all timing/hold checks pass. A
      // concurrent cron/manual request must not release the same earnings twice.
      const claimed = await claimTransaction({
        _id: txn._id,
        flag: 'completionProcessing',
        claimedAt: 'completionClaimedAt',
        extraFilter: { status: orderStates.BUYER_CONFIRMED },
      });
      if (!claimed) {
        return res.status(400).json({ message: 'Order completion is already being processed or has completed' });
      }
      txn.completionProcessing = true;

      // FIX #2: 10% rolling reserve held for 60 days
      const reserveAmount = Math.round(sellerEarnings * timeWindows.SELLER_RESERVE_PERCENT * 100) / 100;
      const availableAmount = sellerEarnings - reserveAmount;
      
      // Move money from pending → available (minus reserve)
      // ATOMIC (round 25): one server-side pipeline update — concurrent
      // releases can no longer lose updates or double-apply money.
      // `settlementKey` extends that from *concurrent* to *repeated*: a retry
      // after a failure further down this route must not pay the seller again.
      const release = await releaseSellerEarnings(seller._id, {
        earnings: sellerEarnings,
        availableAmount,
        reserveAmount,
        settlementKey: txn._id,
        reserveRelease: {
          amount: reserveAmount,
          releaseDate: new Date(Date.now() + timeWindows.SELLER_RESERVE_HOLD_DAYS),
          transactionId: txn._id,
        },
      });
      // Read by the sale counters below only — never by the catch block — so it
      // is deliberately scoped to this try.
      settlementApplied = !settlementAlreadyApplied(release);

      if (settlementApplied) {
        await User.updateOne({ _id: seller._id }, {
          $inc: { 'stats.totalSales': 1 },
          $push: {
            notifications: {
              $each: [{
                type: 'sale',
                listing: txn.listing,
                transaction: txn._id,
                message: `Payment of ${availableAmount} ${txn.currency} released! ${reserveAmount} ${txn.currency} held in reserve (60 days).`,
              }],
              $position: 0,
            },
          },
        });
      }
    }

    // Update buyer stats
    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.stats.totalPurchases = (buyer.stats.totalPurchases || 0) + 1;
      await buyer.save();
    }

    // ROBUST: Boost fee is now EARNED for a completed order.
    // Finalize at the listing level: owed → collected.
    // Platform revenue is booked ONLY for sales that completed. The ledger is
    // per-listing, so a retry could collect a *different* order's owed fee.
    if (settlementApplied) {
      await collectBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
    }

    txn.status = orderStates.COMPLETED;
    txn.completionProcessing = false;
    await txn.save();

    // Keep the consolidated Enterprise Order in sync when ALL txns complete
    await syncOrderFromTransaction(txn, 'completed');

    // Auto-create OR UPGRADE payout record
    // CRITICAL: Use actual breakdown values from the transaction, NOT recalculated
    // Also handles batch checkouts where payouts were created as 'pending' by confirm-batch.
    try {
      const existingPayout = await Payout.findOne({ transaction: txn._id });
      const itemPrice = txn.paymentBreakdown?.subtotal || txn.paymentBreakdown?.totalPaid || txn.itemPrice || 0;
      const storedCommission = txn.paymentBreakdown?.platformFee;
      const commissionRate = (txn.paymentBreakdown?.platformFeePercent ?? 8) / 100;
      const commissionAmount = Number.isFinite(storedCommission) && storedCommission > 0
        ? storedCommission
        : Math.round(itemPrice * commissionRate * 100) / 100;
      const payoutAmount = txn.paymentBreakdown?.sellerEarnings || sellerEarnings;

      if (!existingPayout) {
        await Payout.create({
          seller: txn.seller,
          transaction: txn._id,
          listing: txn.listing,
          salePrice: itemPrice,
          commissionRate,
          commissionAmount,
          payoutAmount,
          status: 'completed',
          paidAt: new Date(),
        });
      } else {
        // Upgrade pending → completed so batch sellers can cash out via process/:id
        // (process/:id refuses to re-process 'pending' payouts; this makes them available)
        if (existingPayout.status === 'pending') {
          existingPayout.status = 'completed';
          existingPayout.paidAt = new Date();
          // Ensure amounts match the confirmed transaction breakdown
          existingPayout.salePrice = itemPrice;
          existingPayout.commissionAmount = commissionAmount;
          existingPayout.payoutAmount = payoutAmount;
          existingPayout.commissionRate = commissionRate;
          await existingPayout.save();
        }
      }
    } catch (pErr) {
      console.error('Auto-payout error:', pErr.message);
    }

    res.json({
      message: 'Order completed. Funds released to seller.',
      transaction: txn,
      sellerEarnings,
    });
  } catch (error) {
    // The filter below is the actual guard and is a no-op once completion
    // persisted. Do NOT gate on the in-memory flag: the route clears it before
    // the final save(), so a failed save would look "already completed" and
    // the order could never be retried.
    if (txn) {
      try {
        await Transaction.updateOne(
          { _id: txn._id, completionProcessing: true },
          { $set: { completionProcessing: false } },
        );
      } catch (rollbackError) {
        console.error('Completion claim rollback failed:', rollbackError.message);
      }
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/orders/:transactionId/request-return
// ============================================================
router.post('/:transactionId/request-return', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'buyer') {
      return res.status(403).json({ message: 'Only buyer can request return' });
    }

    if (!isValidTransition(txn.status, orderStates.RETURN_REQUESTED)) {
      return res.status(400).json({ message: `Cannot request return from '${txn.status}'` });
    }

    // Check return window
    const deliveredAt = txn.shipping?.actualDelivery || txn.updatedAt;
    const returnDeadline = new Date(deliveredAt).getTime() + timeWindows.RETURN_WINDOW;
    if (Date.now() > returnDeadline) {
      return res.status(400).json({
        message: 'Return window has expired (5 days from delivery).',
        returnDeadline: new Date(returnDeadline).toISOString(),
      });
    }

    const { reason, condition, evidence } = req.body;

    // Check return eligibility based on item condition
    const listing = await Listing.findById(txn.listing);
    const conditionRule = returnEligibility.conditions[listing?.condition];
    if (conditionRule && !conditionRule.returnable) {
      return res.status(400).json({ message: conditionRule.reason });
    }

    txn.status = orderStates.RETURN_REQUESTED;
    txn.returnDetails = {
      requestedAt: new Date(),
      deadline: new Date(returnDeadline),
      reason,
      condition,
      buyerPackingProof: evidence || [],
    };

    // Notify seller
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return requested for "${listing?.title}". You have 3 days to respond.`,
      });
      await seller.save();
    }

    await txn.save();

    res.json({
      message: 'Return requested. Seller has 3 days to respond.',
      transaction: txn,
      sellerDeadline: new Date(Date.now() + timeWindows.SELLER_RESPOND_RETURN).toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/orders/:transactionId/accept-return
router.post('/:transactionId/accept-return', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'seller') {
      return res.status(403).json({ message: 'Only seller can accept return' });
    }

    if (!isValidTransition(txn.status, orderStates.RETURN_ACCEPTED)) {
      return res.status(400).json({ message: 'Cannot accept return in current status' });
    }

    txn.status = orderStates.RETURN_ACCEPTED;
    txn.returnDetails = {
      ...txn.returnDetails,
      acceptedAt: new Date(),
      returnShipDeadline: new Date(Date.now() + timeWindows.RETURN_SHIP_WINDOW),
    };

    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: 'Return accepted! Ship the item back within 7 days.',
      });
      await buyer.save();
    }

    await txn.save();

    res.json({
      message: 'Return accepted. Buyer has 7 days to ship the item back.',
      transaction: txn,
      shipDeadline: new Date(Date.now() + timeWindows.RETURN_SHIP_WINDOW).toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/orders/:transactionId/return-shipped
// Buyer marks the return item as shipped back to seller
router.post('/:transactionId/return-shipped', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'buyer') {
      return res.status(403).json({ message: 'Only buyer can mark return as shipped' });
    }

    if (!isValidTransition(txn.status, orderStates.RETURN_IN_TRANSIT)) {
      return res.status(400).json({ message: 'Cannot mark return as shipped in current status' });
    }

    const { trackingNumber, carrier } = req.body;

    txn.status = orderStates.RETURN_IN_TRANSIT;
    txn.returnDetails = {
      ...txn.returnDetails,
      buyerShippedAt: new Date(),
      buyerTrackingNumber: trackingNumber,
      buyerCarrier: carrier,
    };

    // Notify seller
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Buyer shipped return item. Tracking: ${trackingNumber || 'N/A'}`,
      });
      await seller.save();
    }

    await txn.save();

    res.json({
      message: 'Return marked as shipped. Seller will confirm receipt.',
      transaction: txn,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/orders/:transactionId/reject-return
router.post('/:transactionId/reject-return', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'seller') {
      return res.status(403).json({ message: 'Only seller can reject return' });
    }

    // Resuming an interrupted rejection: the previous attempt already stored
    // `return_rejected` and released the seller's funds, then failed while
    // finishing the sale. Answering 400 here (as the plain transition check
    // does, since return_rejected → return_rejected is not a transition) would
    // strand the order with the money paid out and no completion, so the
    // settlement below is resumed instead.
    const resumingRejection = txn.status === orderStates.RETURN_REJECTED;
    if (!resumingRejection && !isValidTransition(txn.status, orderStates.RETURN_REJECTED)) {
      return res.status(400).json({ message: 'Cannot reject return in current status' });
    }

    const { reason, evidence } = req.body;

    if (!resumingRejection) {
      txn.status = orderStates.RETURN_REJECTED;
      txn.returnDetails = {
        ...txn.returnDetails,
        rejectionReason: reason,
        sellerInspectionProof: evidence || [],
      };

      const buyer = await User.findById(txn.buyer);
      if (buyer) {
        buyer.notifications.unshift({
          type: 'sale',
          listing: txn.listing,
          transaction: txn._id,
          message: 'Return rejected. You can file a dispute within 14 days.',
        });
        await buyer.save();
      }

      await txn.save();
    }

    // Transition to completed after rejection (return_rejected -> completed)
    if (isValidTransition(txn.status, orderStates.COMPLETED)) {
      // Update seller balance and create payout (same as auto-complete)
      const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;
      const seller = await User.findById(txn.seller);
      let settlementApplied = true;
      if (seller) {
        const reserveAmount = Math.round(sellerEarnings * timeWindows.SELLER_RESERVE_PERCENT * 100) / 100;
        const availableAmount = sellerEarnings - reserveAmount;
        // ATOMIC (round 25): same release math as auto-complete, one update.
        // This route has no `*Processing` claim of its own, so the exactly-once
        // marker is what stops a retry (or a second concurrent request that
        // already read `return_requested`) from paying the sale twice.
        const release = await releaseSellerEarnings(seller._id, {
          earnings: sellerEarnings,
          availableAmount,
          reserveAmount,
          settlementKey: txn._id,
          reserveRelease: {
            amount: reserveAmount,
            releaseDate: new Date(Date.now() + timeWindows.SELLER_RESERVE_HOLD_DAYS),
            transactionId: txn._id,
          },
        });
        settlementApplied = !settlementAlreadyApplied(release);
        if (settlementApplied) {
          await User.updateOne({ _id: seller._id }, {
            $inc: { 'stats.totalSales': 1 },
            $push: {
              notifications: {
                $each: [{
                  type: 'sale',
                  listing: txn.listing,
                  transaction: txn._id,
                  message: `Return rejected. Payment of ${availableAmount} ${txn.currency} released! ${reserveAmount} ${txn.currency} held in reserve (60 days).`,
                }],
                $position: 0,
              },
            },
          });
        }
      }

      const buyer = await User.findById(txn.buyer);
      if (buyer) {
        buyer.stats.totalPurchases = (buyer.stats.totalPurchases || 0) + 1;
        await buyer.save();
      }

      // Collect boost fee for completed order. The ledger is per-listing, so a
      // retry could collect a *different* order's owed fee.
      if (settlementApplied) {
        await collectBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
      }

      txn.status = orderStates.COMPLETED;
      await txn.save();

      // Create payout record (same as auto-complete)
      try {
        const existingPayout = await Payout.findOne({ transaction: txn._id });
        const itemPrice = txn.paymentBreakdown?.subtotal || txn.paymentBreakdown?.totalPaid || txn.itemPrice || 0;
        const storedCommission = txn.paymentBreakdown?.platformFee;
        const commissionRate = (txn.paymentBreakdown?.platformFeePercent ?? 8) / 100;
        const commissionAmount = Number.isFinite(storedCommission) && storedCommission > 0
          ? storedCommission
          : Math.round(itemPrice * commissionRate * 100) / 100;
        const payoutAmount = txn.paymentBreakdown?.sellerEarnings || sellerEarnings;

        if (!existingPayout) {
          await Payout.create({
            seller: txn.seller,
            transaction: txn._id,
            listing: txn.listing,
            salePrice: itemPrice,
            commissionRate,
            commissionAmount,
            payoutAmount,
            status: 'completed',
            paidAt: new Date(),
          });
        } else if (existingPayout.status === 'pending') {
          existingPayout.status = 'completed';
          existingPayout.paidAt = new Date();
          existingPayout.salePrice = itemPrice;
          existingPayout.commissionAmount = commissionAmount;
          existingPayout.payoutAmount = payoutAmount;
          existingPayout.commissionRate = commissionRate;
          await existingPayout.save();
        }
      } catch (pErr) {
        console.error('Payout creation on return-rejected failed:', pErr.message);
      }

      // Keep the consolidated Enterprise Order in sync
      await syncOrderFromTransaction(txn, 'completed');
    }

    res.json({
      message: 'Return rejected. Buyer can file a dispute within 14 days.',
      transaction: txn,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/orders/:transactionId/confirm-return-received
// CRITICAL: Refund buyer, deduct from seller, restore inventory
router.post('/:transactionId/confirm-return-received', auth, validateOrderAccess, async (req, res) => {
  // Declared OUTSIDE the try so the catch can release the return claim.
  let txn;
  try {
    txn = req.transaction;

    if (req.orderRole !== 'seller') {
      return res.status(403).json({ message: 'Only seller can confirm return receipt' });
    }

    if (!isValidTransition(txn.status, orderStates.RETURN_DELIVERED)) {
      return res.status(400).json({ message: 'Cannot confirm return receipt in current status' });
    }

    const claimedReturn = await Transaction.findOneAndUpdate(
      { _id: txn._id, status: { $in: [orderStates.RETURN_IN_TRANSIT, orderStates.RETURN_DELIVERED] }, returnProcessing: { $ne: true } },
      { $set: { returnProcessing: true } },
      { new: true },
    );
    if (!claimedReturn) {
      return res.status(400).json({ message: 'Return settlement is already being processed or has completed' });
    }
    txn = claimedReturn;

    const { condition, inspectionNotes, sellerPackingProof } = req.body;

    // Calculate refund: buyer gets back totalPaid (item + shipping + protection)
    const refundAmount = txn.paymentBreakdown.totalPaid || 0;
    const sellerEarnings = txn.paymentBreakdown.sellerEarnings || 0;

    // Issue proper Stripe refund
    const paymentIntentId = txn.payout?.transactionId;
    let stripeRefundResult = null;
    if (paymentIntentId) {
      try {
        const { retrievePaymentIntent, issueRefund, releaseAuthorization } = require('../config/payments');
        const pi = await retrievePaymentIntent(paymentIntentId);
        if (pi.status === 'succeeded') {
          stripeRefundResult = await issueRefund(paymentIntentId);
        } else if (pi.status === 'requires_capture') {
          stripeRefundResult = await releaseAuthorization(paymentIntentId);
        }
      } catch (stripeErr) {
        stripeErr.statusCode = 502;
        throw stripeErr;
      }
    }

    // Provider refund succeeded (or authorization was released); now apply
    // the local zero-sum unwind. No inventory or ledger mutation occurs before
    // this point, so provider failures remain fully retryable.
    await Listing.findByIdAndUpdate(txn.listing, {
      $inc: { quantity: txn.quantity || 1, quantitySold: -(txn.quantity || 1) },
      $set: { sold: false, available: true },
    });
    await reverseBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
    await markPayoutRefunded(txn);

    // Notify buyer of refund
    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return received. Refund of ${refundAmount} ${txn.currency} has been processed to your original payment method.`,
      });
      await buyer.save();
    }

    // ROBUST: Claw back from available or pending balance
    const seller = await User.findById(txn.seller);
    if (seller) {
      // ATOMIC (round 25): the available→pending split is computed server-side
      // inside one update, so concurrent refunds can never over-refund.
      await clawbackSellerEarnings(seller._id, sellerEarnings);
      seller.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return confirmed. ${refundAmount} ${txn.currency} refunded to buyer.`,
      });
      await seller.save();
    }

    txn.status = orderStates.REFUNDED;
    txn.returnDetails = {
      ...txn.returnDetails,
      receivedAt: new Date(),
      inspectionNotes,
      sellerInspectionProof: sellerPackingProof || [],
    };
    txn.payout = { status: 'refunded', processedAt: new Date() };
    txn.returnProcessing = false;

    await txn.save();

    // Keep the consolidated Enterprise Order in sync after a return refund
    await syncOrderFromTransaction(txn, 'refunded');

    res.json({
      message: 'Return confirmed. Full refund issued to buyer via original payment method.',
      transaction: txn,
      refundAmount,
      stripeRefund: stripeRefundResult,
    });
  } catch (error) {
    // The filter below ($set only while the claim is still held) is the actual
    // guard; gating on the in-memory flag would skip the rollback whenever the
    // final save() is what failed.
    if (txn) {
      try {
        await Transaction.updateOne({ _id: txn._id, returnProcessing: true }, { $set: { returnProcessing: false } });
      } catch (rollbackError) {
        console.error('Return settlement claim rollback failed:', rollbackError.message);
      }
    }
    console.error(error);
    res.status(error.statusCode || 500).json({ message: error.statusCode === 502 ? 'Refund could not be processed right now. Please retry.' : 'Server error' });
  }
});

// POST /api/orders/:transactionId/process-return
// Alias: Redirects to confirm-return-received logic (uses robust claw-back)
// Kept for backward compatibility - delegates to the robust implementation
router.post('/:transactionId/process-return', auth, validateOrderAccess, async (req, res) => {
  // Declared OUTSIDE the try so the catch can release the return claim.
  let txn;
  try {
    txn = req.transaction;

    if (req.orderRole !== 'seller') {
      return res.status(403).json({ message: 'Only seller can process return' });
    }

    // Validate transition: process-return works from return_delivered
    if (!isValidTransition(txn.status, orderStates.REFUNDED)) {
      return res.status(400).json({ message: 'Cannot process return in current status' });
    }

    const claimedReturn = await Transaction.findOneAndUpdate(
      { _id: txn._id, status: { $in: [orderStates.RETURN_IN_TRANSIT, orderStates.RETURN_DELIVERED] }, returnProcessing: { $ne: true } },
      { $set: { returnProcessing: true } },
      { new: true },
    );
    if (!claimedReturn) {
      return res.status(400).json({ message: 'Return settlement is already being processed or has completed' });
    }
    txn = claimedReturn;

    const { condition, inspectionNotes, sellerPackingProof } = req.body;

    // Calculate refund: buyer gets back totalPaid (item + shipping + protection)
    const refundAmount = txn.paymentBreakdown.totalPaid || 0;
    const sellerEarnings = txn.paymentBreakdown.sellerEarnings || 0;

    // Issue proper Stripe refund
    const paymentIntentId = txn.payout?.transactionId;
    let stripeRefundResult = null;
    if (paymentIntentId) {
      try {
        const { retrievePaymentIntent, issueRefund, releaseAuthorization } = require('../config/payments');
        const pi = await retrievePaymentIntent(paymentIntentId);
        if (pi.status === 'succeeded') {
          stripeRefundResult = await issueRefund(paymentIntentId);
        } else if (pi.status === 'requires_capture') {
          stripeRefundResult = await releaseAuthorization(paymentIntentId);
        }
      } catch (stripeErr) {
        stripeErr.statusCode = 502;
        throw stripeErr;
      }
    }

    // Provider refund succeeded (or authorization was released); now apply
    // the local zero-sum unwind. No inventory or ledger mutation occurs before
    // this point, so provider failures remain fully retryable.
    await Listing.findByIdAndUpdate(txn.listing, {
      $inc: { quantity: txn.quantity || 1, quantitySold: -(txn.quantity || 1) },
      $set: { sold: false, available: true },
    });
    await reverseBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
    await markPayoutRefunded(txn);

    // Notify buyer of refund
    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return processed. Refund of ${refundAmount} ${txn.currency} has been processed to your original payment method.`,
      });
      await buyer.save();
    }

    // ROBUST: Claw back from available or pending balance (same as confirm-return-received)
    const seller = await User.findById(txn.seller);
    if (seller) {
      // ATOMIC (round 25): server-side split, no lost updates.
      await clawbackSellerEarnings(seller._id, sellerEarnings);
      seller.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return processed. ${refundAmount} ${txn.currency} refunded to buyer.`,
      });
      await seller.save();
    }

    txn.status = orderStates.REFUNDED;
    txn.returnDetails = {
      ...txn.returnDetails,
      receivedAt: new Date(),
      inspectionNotes,
      sellerInspectionProof: sellerPackingProof || [],
    };
    txn.payout = { status: 'refunded', processedAt: new Date() };
    txn.returnProcessing = false;

    await txn.save();

    // Keep the consolidated Enterprise Order in sync after a processed return
    await syncOrderFromTransaction(txn, 'refunded');

    res.json({
      message: 'Return processed. Full refund issued to buyer via original payment method.',
      transaction: txn,
      refundAmount,
      stripeRefund: stripeRefundResult,
    });
  } catch (error) {
    // The filter below ($set only while the claim is still held) is the actual
    // guard; gating on the in-memory flag would skip the rollback whenever the
    // final save() is what failed.
    if (txn) {
      try {
        await Transaction.updateOne({ _id: txn._id, returnProcessing: true }, { $set: { returnProcessing: false } });
      } catch (rollbackError) {
        console.error('Return settlement claim rollback failed:', rollbackError.message);
      }
    }
    console.error(error);
    res.status(error.statusCode || 500).json({ message: error.statusCode === 502 ? 'Refund could not be processed right now. Please retry.' : 'Server error' });
  }
});

// POST /api/orders/:transactionId/dispute
router.post('/:transactionId/dispute', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;
    const { reason, evidence } = req.body;

    if (!isValidTransition(txn.status, orderStates.DISPUTED)) {
      return res.status(400).json({ message: 'Cannot file dispute in current status' });
    }

    if (!reason) {
      return res.status(400).json({ message: 'Dispute requires a reason' });
    }

    txn.status = orderStates.DISPUTED;
    txn.dispute = {
      reason,
      filedBy: req.user._id,
      filedAt: new Date(),
      evidence: evidence || [],
      responseDeadline: new Date(Date.now() + disputeProcess.responseWindow),
    };

    const otherUserId = req.orderRole === 'buyer' ? txn.seller : txn.buyer;
    const otherUser = await User.findById(otherUserId);
    if (otherUser) {
      otherUser.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Dispute filed by ${req.orderRole}. Respond within 48 hours.`,
      });
      await otherUser.save();
    }

    await txn.save();

    res.json({
      message: 'Dispute filed. Other party has 48 hours to respond.',
      transaction: txn,
      responseDeadline: txn.dispute.responseDeadline,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/orders/:transactionId/resolve-dispute
// Enterprise standard: a filed dispute MUST be resolvable. The seller (or an
// admin) resolves with either a full buyer refund ('refund') or a release of
// funds to the seller ('release' / 'reject'). Without this endpoint a dispute
// could be filed but never closed — money stuck forever.
// State machine: disputed → refunded | dispute_resolved
// ============================================================
router.post('/:transactionId/resolve-dispute', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;
    const { resolution, notes } = req.body;

    if (!isValidTransition(txn.status, orderStates.DISPUTED) &&
        !isValidTransition(txn.status, orderStates.REFUNDED) &&
        !isValidTransition(txn.status, orderStates.DISPUTE_RESOLVED)) {
      return res.status(400).json({ message: `Cannot resolve dispute from '${txn.status}'` });
    }
    if (txn.status !== orderStates.DISPUTED) {
      return res.status(400).json({ message: `Order is not disputed (status: ${txn.status})` });
    }
    // Only the counter-party (seller) or an admin may resolve a dispute.
    if (req.orderRole !== 'seller' && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the seller or an admin can resolve a dispute' });
    }
    const normalized = String(resolution || '').toLowerCase();
    if (!['refund', 'release', 'reject'].includes(normalized)) {
      return res.status(400).json({ message: "resolution must be 'refund', 'release', or 'reject'" });
    }

    if (normalized === 'refund') {
      // Full buyer refund — same robust claw-back as the return flow.
      await Listing.findByIdAndUpdate(txn.listing, {
        $inc: { quantity: txn.quantity || 1, quantitySold: -(txn.quantity || 1) },
        $set: { sold: false, available: true },
      });
      await reverseBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
      await markPayoutRefunded(txn);

      const refundAmount = txn.paymentBreakdown.totalPaid || 0;
      const sellerEarnings = txn.paymentBreakdown.sellerEarnings || 0;

      let stripeRefundResult = null;
      const paymentIntentId = txn.payout?.transactionId;
      if (paymentIntentId) {
        try {
          const { retrievePaymentIntent, issueRefund, releaseAuthorization } = require('../config/payments');
          const pi = await retrievePaymentIntent(paymentIntentId);
          if (pi.status === 'succeeded') {
            stripeRefundResult = await issueRefund(paymentIntentId);
          } else if (pi.status === 'requires_capture') {
            stripeRefundResult = await releaseAuthorization(paymentIntentId);
          }
        } catch (stripeErr) {
          console.error('Stripe refund on dispute resolution:', stripeErr.message);
        }
      }

      const buyer = await User.findById(txn.buyer);
      if (buyer) {
        buyer.notifications.unshift({
          type: 'sale',
          listing: txn.listing,
          transaction: txn._id,
          message: `Dispute resolved in your favor. Refund of ${refundAmount} ${txn.currency} processed.`,
        });
        await buyer.save();
      }

      const seller = await User.findById(txn.seller);
      if (seller) {
        // ATOMIC (round 25): server-side split, no lost updates.
        await clawbackSellerEarnings(seller._id, sellerEarnings);
        seller.notifications.unshift({
          type: 'sale',
          listing: txn.listing,
          transaction: txn._id,
          message: `Dispute resolved with a refund. ${refundAmount} ${txn.currency} returned to the buyer.`,
        });
        await seller.save();
      }

      txn.status = orderStates.REFUNDED;
      txn.dispute = {
        ...txn.dispute,
        resolvedAt: new Date(),
        resolution: 'refund',
        resolutionNotes: notes || '',
      };
      txn.payout = { status: 'refunded', processedAt: new Date() };
      await txn.save();
      await syncOrderFromTransaction(txn, 'refunded');

      return res.json({
        message: 'Dispute resolved with a full buyer refund.',
        transaction: txn,
        resolution: 'refund',
        refundAmount,
        stripeRefund: stripeRefundResult,
      });
    }

    // 'release' / 'reject' — dispute resolved in the seller's favor.
    txn.status = orderStates.DISPUTE_RESOLVED;
    txn.dispute = {
      ...txn.dispute,
      resolvedAt: new Date(),
      resolution: 'release',
      resolutionNotes: notes || '',
    };
    await txn.save();
    await syncOrderFromTransaction(txn, 'dispute_resolved');

    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: 'Dispute resolved in the seller\'s favor. Funds will be released to the seller.',
      });
      await buyer.save();
    }

    return res.json({
      message: 'Dispute resolved in the seller\'s favor.',
      transaction: txn,
      resolution: 'release',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/orders/auto-process - SYSTEM ONLY

// ============================================================
// POST /api/orders/auto-process - SYSTEM ONLY
// Processes all auto-advancements:
// 1. delivered + 3 days → auto buyer_confirmed
// 2. buyer_confirmed + 3 days → auto completed (release funds)
// Called by cron job or manually
// ============================================================
router.post('/auto-process', async (req, res) => {
  try {
    // This endpoint releases seller funds across the entire platform. It is
    // an internal job endpoint, not a public API: production must configure a
    // dedicated secret so arbitrary callers cannot trigger early payouts.
    const configuredJobSecret = process.env.ORDER_AUTO_PROCESS_SECRET;
    if (process.env.NODE_ENV === 'production' && !configuredJobSecret) {
      console.error('Order auto-process disabled: ORDER_AUTO_PROCESS_SECRET is not configured');
      return res.status(503).json({ message: 'Order auto-process is not configured' });
    }
    if (process.env.NODE_ENV === 'production' && req.get('x-order-auto-process-secret') !== configuredJobSecret) {
      return res.status(403).json({ message: 'Invalid order auto-process secret' });
    }

    const now = Date.now();
    let updated = 0;
    let completed = 0;
    let delivered = 0;
    let failed = 0;

    // 1. Auto-advance delivered → buyer_confirmed after 3 days of no action
    // CRITICAL: Skip refunded/cancelled transactions
    const deliveredOrders = await Transaction.find({
      status: orderStates.DELIVERED,
      'payout.status': { $ne: 'refunded' },
    });

    for (const txn of deliveredOrders) {
      const deliveryTime = txn.shipping?.actualDelivery ? new Date(txn.shipping.actualDelivery).getTime() : new Date(txn.updatedAt).getTime();
      if (now - deliveryTime >= timeWindows.BUYER_CONFIRM_DELIVERY) {
        // Isolate this shipment: a failure here must not abort the job before
        // the fund-release phase below has run for anyone.
        try {
          txn.status = orderStates.BUYER_CONFIRMED;
          txn.buyerConfirmed = {
            received: true,
            confirmedAt: new Date(),
            autoConfirmed: true,
          };
          await txn.save();
          delivered++;
        } catch (advanceError) {
          console.error(`[AUTO-PROCESS] Auto-confirm failed for ${txn._id}:`, advanceError.message);
        }
      }
    }

    // 2. Auto-advance buyer_confirmed → completed (release funds)
    // CRITICAL: Skip refunded/cancelled transactions to prevent releasing funds after refund
    const confirmedOrders = await Transaction.find({
      status: orderStates.BUYER_CONFIRMED,
      'payout.status': { $ne: 'refunded' },
    });

    for (const txn of confirmedOrders) {
      const confirmTime = txn.buyerConfirmed?.confirmedAt ? new Date(txn.buyerConfirmed.confirmedAt).getTime() : new Date(txn.updatedAt).getTime();
      if (now - confirmTime >= timeWindows.AUTO_COMPLETE) {
        // Atomically claim this completion before any balance/stat/payout
        // mutation. Concurrent cron invocations must process a transaction
        // exactly once.
        const claimed = await claimTransaction({
          _id: txn._id,
          flag: 'completionProcessing',
          claimedAt: 'completionClaimedAt',
          extraFilter: { status: orderStates.BUYER_CONFIRMED },
        });
        if (!claimed) continue;
        txn.completionProcessing = true;

        // Isolate this order: a failure below must neither abort the remaining
        // orders nor leave this one claimed forever. Without this, ONE poisoned
        // row stops every other seller's payout and keeps its own claim set, so
        // the next run walks straight into the same wall.
        //
        // Residual risk (follow-up): the balance release inside is not
        // idempotent, so a retry after a failure that happened AFTER funds
        // moved can double-apply. Never paying the seller (the alternative) is
        // strictly worse, so the claim is released.
        try {
          const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;
  
          // Release funds to seller with 10% rolling reserve
          const seller = await User.findById(txn.seller);
          if (!seller) {
            // Do not finalize a paid sale when its seller account is missing:
            // otherwise the buyer's payment is captured but no seller ledger is
            // credited. Clear the claim and leave the transaction retryable for
            // reconciliation after the account is repaired.
            await Transaction.updateOne(
              { _id: txn._id, completionProcessing: true },
              { $set: { completionProcessing: false } },
            );
            continue;
          }
          // True once this order's funds are with the seller (or an earlier
          // attempt already put them there) — gates every payout-side effect.
          let settlementApplied = true;
          {
            // CRITICAL: Apply 10% rolling reserve and new seller hold checks
            const isNewSeller = (seller.stats.totalSales || 0) < timeWindows.NEW_SELLER_THRESHOLD;
            let canRelease = true;
            
            if (isNewSeller) {
              const accountAge = Date.now() - new Date(seller.createdAt).getTime();
              if (accountAge < timeWindows.NEW_SELLER_HOLD) {
                canRelease = false;
              }
            }
            
            if (canRelease) {
              const reserveAmount = Math.round(sellerEarnings * timeWindows.SELLER_RESERVE_PERCENT * 100) / 100;
              const availableAmount = sellerEarnings - reserveAmount;
  
              // ATOMIC (round 25): one server-side pipeline update for the
              // balance + reserve; the cron and a concurrent manual
              // auto-complete can never both apply the release.
              const release = await releaseSellerEarnings(seller._id, {
                earnings: sellerEarnings,
                availableAmount,
                reserveAmount,
                settlementKey: txn._id,
                reserveRelease: {
                  amount: reserveAmount,
                  releaseDate: new Date(Date.now() + timeWindows.SELLER_RESERVE_HOLD_DAYS),
                  transactionId: txn._id,
                },
              });
              settlementApplied = !settlementAlreadyApplied(release);
            } else {
              // New seller hold - funds stay in pending. Record when the hold
              // matures or the money is stranded: this order completes now, so
              // nothing else will ever come back for the release.
              txn.settlementHold = {
                reason: 'new_seller',
                releaseAfter: new Date(new Date(seller.createdAt).getTime() + timeWindows.NEW_SELLER_HOLD),
                releasedAt: null,
              };
              seller.notifications.unshift({
                type: 'sale',
                listing: txn.listing,
                transaction: txn._id,
                message: `Payment held: New seller hold active until account is 14 days old.`,
              });
            }
  
            if (settlementApplied) {
              await User.updateOne(
                { _id: seller._id },
                { $inc: { 'stats.totalSales': 1 } }
              );
              await seller.save();
            }
          }
  
          // Update buyer stats
          const buyer = await User.findById(txn.buyer);
          if (buyer) {
            buyer.stats.totalPurchases = (buyer.stats.totalPurchases || 0) + 1;
            await buyer.save();
          }
  
          // ROBUST: Boost fee is now EARNED for a completed order.
          // Finalize at the listing level: owed → collected. The ledger is
          // per-listing, so a retry could collect a *different* order's owed fee.
          if (settlementApplied) {
            await collectBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
          }
  
          txn.status = orderStates.COMPLETED;
          txn.completionProcessing = false;
          await txn.save();
  
          // Keep the consolidated Enterprise Order in sync after batch completion
          await syncOrderFromTransaction(txn, 'completed');
  
          // Auto-create payout
          // CRITICAL: Use actual breakdown values, NOT recalculated from totalPaid
          try {
            const existingPayout = await Payout.findOne({ transaction: txn._id });
            if (!existingPayout) {
              const itemPrice = txn.paymentBreakdown?.subtotal || txn.paymentBreakdown?.totalPaid || txn.itemPrice || 0;
              const commissionAmount = txn.paymentBreakdown?.platformFee || 0;
              const payoutAmount = txn.paymentBreakdown?.sellerEarnings || sellerEarnings;
              // Funds withheld by a hold are not paid yet; recording them as
              // 'completed' reports the money as available while it is still
              // escrowed. releaseHeldSettlements upgrades this row later.
              const fundsHeld = Boolean(txn.settlementHold?.releaseAfter);
              await Payout.create({
                seller: txn.seller,
                transaction: txn._id,
                listing: txn.listing,
                salePrice: itemPrice,
                commissionRate: (txn.paymentBreakdown?.platformFeePercent ?? 8) / 100,
                commissionAmount,
                payoutAmount,
                status: fundsHeld ? 'pending' : 'completed',
                paidAt: fundsHeld ? undefined : new Date(),
              });
            }
          } catch (pErr) {
            console.error('Auto-payout error:', pErr.message);
          }
  
          completed++;
        } catch (txnError) {
          // Release the claim so a later run retries THIS order, then keep
          // processing the orders that are still healthy.
          failed++;
          console.error(`[AUTO-PROCESS] Order ${txn._id} failed:`, txnError.message);
          try {
            await Transaction.updateOne(
              { _id: txn._id, completionProcessing: true },
              { $set: { completionProcessing: false } },
            );
          } catch (rollbackError) {
            console.error(`[AUTO-PROCESS] Claim rollback failed for ${txn._id}:`, rollbackError.message);
          }
        }
      }
    }

    res.json({
      message: `Auto-processed: ${delivered} auto-confirmed, ${completed} auto-completed with funds released.`,
      autoConfirmed: delivered,
      autoCompleted: completed,
      autoFailed: failed,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/orders/:transactionId/lifecycle
router.get('/:transactionId/lifecycle', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;
    const role = req.orderRole;
    const now = Date.now();
    const deliveredAt = txn.shipping?.actualDelivery ? new Date(txn.shipping.actualDelivery).getTime() : null;
    // Viewer-aware money view (buyers never see the seller's boost fee).
    const txnView = sanitizeTransactionForViewer(txn, req.user._id);

    res.json({
      transaction: txnView,
      role,
      status: txn.status,
      allowedActions: getAllowedActions(txn.status, role),
      timeline: {
        created: txn.createdAt,
        paid: txn.createdAt,
        shipped: txn.shipping?.labelCreatedDate,
        delivered: txn.shipping?.actualDelivery,
        confirmed: txn.buyerConfirmed?.confirmedAt,
        completed: txn.status === 'completed' ? txn.updatedAt : null,
      },
      windows: {
        returnDeadline: deliveredAt ? new Date(deliveredAt + timeWindows.RETURN_WINDOW) : null,
        disputeDeadline: deliveredAt ? new Date(deliveredAt + timeWindows.DISPUTE_WINDOW) : null,
        canReturn: deliveredAt && now <= deliveredAt + timeWindows.RETURN_WINDOW,
        canDispute: deliveredAt && now <= deliveredAt + timeWindows.DISPUTE_WINDOW,
      },
      payment: txnView.paymentBreakdown,
      ...(txnView.sellerBreakdown ? { sellerBreakdown: txnView.sellerBreakdown } : {}),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

// Export internal helpers for system jobs (cron auto-refund on
// unconfirmed return delivery) — not part of the public router API.
module.exports.reverseBoostFeeOwed = reverseBoostFeeOwed;
module.exports.markPayoutRefunded = markPayoutRefunded;
module.exports.syncOrderFromTransaction = syncOrderFromTransaction;
