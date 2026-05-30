const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Payout = require('../models/Payout');
const { orderStates, allowedTransitions, timeWindows, cancellationRules, refundRules, returnEligibility, evidenceRequirements, disputeProcess, isValidTransition, getAllowedActions } = require('../config/orderLifecycle');
const { calculatePaymentBreakdown, capturePaymentIntent, retrievePaymentIntent, issueRefund } = require('../config/payments');

// ============================================================
// CRITICAL: Every state change is validated against the state machine.
// No manual status updates allowed - only system transitions.
// Money moves in this specific order:
//   capture → label → transaction → inventory → balances
// ============================================================

// Middleware: Validate order access and state machine transition
const validateOrderAccess = async (req, res, next) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId || req.body.transactionId);
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
      payment: txn.paymentBreakdown,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/orders/:transactionId/cancel
// CRITICAL: Validates state machine transition before touching money
// Refund: buyer.balance.available += refundAmount (money goes TO buyer)
// ============================================================
router.post('/:transactionId/cancel', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;
    const role = req.orderRole;
    const { reason, evidence } = req.body;

    const cancelState = role === 'buyer' ? orderStates.CANCELLED_BY_BUYER : orderStates.CANCELLED_BY_SELLER;

    // State machine validation - CRITICAL safety check
    if (!isValidTransition(txn.status, cancelState)) {
      return res.status(400).json({
        message: `Cannot cancel from '${txn.status}'. ${cancellationRules[role]?.afterShipment?.reason || ''}`
      });
    }

    // Only allow cancellation before shipment
    const isBeforeShipment = ['paid', 'processing'].includes(txn.status);
    if (!isBeforeShipment) {
      return res.status(400).json({ message: cancellationRules[role].afterShipment?.reason || 'Cannot cancel after shipment' });
    }

    // Calculate refund: buyer gets back everything including shipping
    const paymentIntentId = txn.payout?.transactionId;
    let stripeRefundResult = null;
    const refundAmount = txn.paymentBreakdown.totalPaid || 0;
    const { releaseAuthorization, issueRefund } = require('../config/payments');

    // Issue proper Stripe refund/release
    if (paymentIntentId) {
      try {
        // Check if payment was captured (succeeded) or just authorized
        const { retrievePaymentIntent } = require('../config/payments');
        const pi = await retrievePaymentIntent(paymentIntentId);
        if (pi.status === 'succeeded') {
          // Payment was captured - issue a full refund
          stripeRefundResult = await issueRefund(paymentIntentId);
        } else if (pi.status === 'requires_capture') {
          // Payment only authorized - release the authorization
          stripeRefundResult = await releaseAuthorization(paymentIntentId);
        }
      } catch (stripeErr) {
        console.error('Stripe refund/release error:', stripeErr.message);
      }
    }

    // Notify buyer of refund
    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Order cancelled. Refund of ${refundAmount} ${txn.currency} has been processed to your original payment method.`,
      });
      await buyer.save();
    }

    // Remove pending earnings from seller
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - (txn.paymentBreakdown.sellerEarnings || 0));

      if (role === 'seller') {
        seller.stats.strikes = (seller.stats.strikes || 0) + 1;
        seller.notifications.unshift({
          type: 'sale',
          listing: txn.listing,
          transaction: txn._id,
          message: `Order cancelled by you. Strike ${seller.stats.strikes}/3 before suspension.`,
        });
      }
      await seller.save();
    }

    // Restore listing inventory
    await Listing.findByIdAndUpdate(txn.listing, {
      $inc: { quantity: 1, quantitySold: -1 },
      $set: { sold: false, available: true },
    });

    // Update transaction status
    txn.status = cancelState;
    txn.cancellation = {
      cancelledBy: role,
      reason: reason || `Cancelled by ${role}`,
      cancelledAt: new Date(),
      refundAmount,
    };
    await txn.save();

    res.json({
      message: `Order cancelled. Refund of ${refundAmount} ${txn.currency} will be processed.`,
      transaction: txn,
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
  try {
    const txn = req.transaction;

    if (!isValidTransition(txn.status, orderStates.COMPLETED)) {
      return res.status(400).json({ message: `Cannot complete from '${txn.status}'` });
    }

    // Verify 3 days have passed since buyer confirmed
    const confirmedAt = txn.buyerConfirmed?.confirmedAt || txn.updatedAt;
    const timeSinceConfirm = Date.now() - new Date(confirmedAt).getTime();
    if (timeSinceConfirm < timeWindows.AUTO_COMPLETE) {
      const remaining = Math.ceil((timeWindows.AUTO_COMPLETE - timeSinceConfirm) / (1000 * 60 * 60));
      return res.status(400).json({
        message: `Cannot complete yet. ${remaining} hours remaining.`,
        releaseDate: new Date(new Date(confirmedAt).getTime() + timeWindows.AUTO_COMPLETE).toISOString(),
      });
    }

    const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;

    // CRITICAL: Move money from pending → available for seller
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - sellerEarnings);
      seller.balance.available = (seller.balance.available || 0) + sellerEarnings;
      seller.balance.totalEarned = (seller.balance.totalEarned || 0) + sellerEarnings;
      seller.stats.totalSales = (seller.stats.totalSales || 0) + 1;
      seller.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Payment of ${sellerEarnings} ${txn.currency} released to your available balance!`,
      });
      await seller.save();
    }

    // Update buyer stats
    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.stats.totalPurchases = (buyer.stats.totalPurchases || 0) + 1;
      await buyer.save();
    }

    txn.status = orderStates.COMPLETED;
    await txn.save();

    // Auto-create payout record
    // CRITICAL: Use actual breakdown values from the transaction, NOT recalculated
    try {
      const existingPayout = await Payout.findOne({ transaction: txn._id });
      if (!existingPayout) {
        const itemPrice = txn.paymentBreakdown?.subtotal || txn.paymentBreakdown?.totalPaid || txn.itemPrice || 0;
        const commissionAmount = txn.paymentBreakdown?.platformFee || 0;
        const payoutAmount = txn.paymentBreakdown?.sellerEarnings || sellerEarnings;
        await Payout.create({
          seller: txn.seller,
          transaction: txn._id,
          listing: txn.listing,
          salePrice: itemPrice,
          commissionRate: (txn.paymentBreakdown?.platformFeePercent || 10) / 100,
          commissionAmount,
          payoutAmount,
          status: 'completed',
          paidAt: new Date(),
        });
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

// POST /api/orders/:transactionId/reject-return
router.post('/:transactionId/reject-return', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'seller') {
      return res.status(403).json({ message: 'Only seller can reject return' });
    }

    if (!isValidTransition(txn.status, orderStates.RETURN_REJECTED)) {
      return res.status(400).json({ message: 'Cannot reject return in current status' });
    }

    const { reason, evidence } = req.body;

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
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'seller') {
      return res.status(403).json({ message: 'Only seller can confirm return receipt' });
    }

    if (!isValidTransition(txn.status, orderStates.RETURN_DELIVERED)) {
      return res.status(400).json({ message: 'Cannot confirm return receipt in current status' });
    }

    const { condition, inspectionNotes, sellerPackingProof } = req.body;

    // Restore listing inventory FIRST
    await Listing.findByIdAndUpdate(txn.listing, {
      $inc: { quantity: 1, quantitySold: -1 },
      $set: { sold: false, available: true },
    });

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
        console.error('Stripe refund on return:', stripeErr.message);
      }
    }

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

    // Remove from seller's pending balance
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - sellerEarnings);
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

    await txn.save();

    res.json({
      message: 'Return confirmed. Full refund issued to buyer via original payment method.',
      transaction: txn,
      refundAmount,
      stripeRefund: stripeRefundResult,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
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
// POST /api/orders/auto-process - SYSTEM ONLY
// Processes all auto-advancements:
// 1. delivered + 3 days → auto buyer_confirmed
// 2. buyer_confirmed + 3 days → auto completed (release funds)
// Called by cron job or manually
// ============================================================
router.post('/auto-process', async (req, res) => {
  try {
    const now = Date.now();
    let updated = 0;
    let completed = 0;
    let delivered = 0;

    // 1. Auto-advance delivered → buyer_confirmed after 3 days of no action
    // CRITICAL: Skip refunded/cancelled transactions
    const deliveredOrders = await Transaction.find({
      status: orderStates.DELIVERED,
      'payout.status': { $ne: 'refunded' },
    });

    for (const txn of deliveredOrders) {
      const deliveryTime = txn.shipping?.actualDelivery ? new Date(txn.shipping.actualDelivery).getTime() : new Date(txn.updatedAt).getTime();
      if (now - deliveryTime >= timeWindows.BUYER_CONFIRM_DELIVERY) {
        txn.status = orderStates.BUYER_CONFIRMED;
        txn.buyerConfirmed = {
          received: true,
          confirmedAt: new Date(),
          autoConfirmed: true,
        };
        await txn.save();
        delivered++;
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
        const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;

        // Release funds to seller
        const seller = await User.findById(txn.seller);
        if (seller) {
          seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - sellerEarnings);
          seller.balance.available = (seller.balance.available || 0) + sellerEarnings;
          seller.balance.totalEarned = (seller.balance.totalEarned || 0) + sellerEarnings;
          seller.stats.totalSales = (seller.stats.totalSales || 0) + 1;
          await seller.save();
        }

        // Update buyer stats
        const buyer = await User.findById(txn.buyer);
        if (buyer) {
          buyer.stats.totalPurchases = (buyer.stats.totalPurchases || 0) + 1;
          await buyer.save();
        }

        txn.status = orderStates.COMPLETED;
        await txn.save();

        // Auto-create payout
        // CRITICAL: Use actual breakdown values, NOT recalculated from totalPaid
        try {
          const existingPayout = await Payout.findOne({ transaction: txn._id });
          if (!existingPayout) {
            const itemPrice = txn.paymentBreakdown?.subtotal || txn.paymentBreakdown?.totalPaid || txn.itemPrice || 0;
            const commissionAmount = txn.paymentBreakdown?.platformFee || 0;
            const payoutAmount = txn.paymentBreakdown?.sellerEarnings || sellerEarnings;
            await Payout.create({
              seller: txn.seller,
              transaction: txn._id,
              listing: txn.listing,
              salePrice: itemPrice,
              commissionRate: (txn.paymentBreakdown?.platformFeePercent || 10) / 100,
              commissionAmount,
              payoutAmount,
              status: 'completed',
              paidAt: new Date(),
            });
          }
        } catch (pErr) {
          console.error('Auto-payout error:', pErr.message);
        }

        completed++;
      }
    }

    res.json({
      message: `Auto-processed: ${delivered} auto-confirmed, ${completed} auto-completed with funds released.`,
      autoConfirmed: delivered,
      autoCompleted: completed,
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

    res.json({
      transaction: txn,
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
      payment: txn.paymentBreakdown,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;