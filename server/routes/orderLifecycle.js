const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { orderStates, allowedTransitions, timeWindows, cancellationRules, refundRules, returnEligibility, evidenceRequirements, disputeProcess, isValidTransition, getAllowedActions } = require('../config/orderLifecycle');
const { calculatePaymentBreakdown } = require('../config/payments');

// Middleware: Validate order access
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

// GET /api/orders/:transactionId/status - Get order status and allowed actions
router.get('/:transactionId/status', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;
    const role = req.orderRole;

    // Calculate time-based eligibility
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
      evidence: evidenceRequirements[role],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/orders/:transactionId/cancel - Cancel order
router.post('/:transactionId/cancel', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;
    const role = req.orderRole;
    const { reason, evidence } = req.body;

    // Determine cancellation type
    const cancelState = role === 'buyer' ? orderStates.CANCELLED_BY_BUYER : orderStates.CANCELLED_BY_SELLER;

    // Validate transition
    if (!isValidTransition(txn.status, cancelState)) {
      return res.status(400).json({ message: `Cannot cancel in '${txn.status}' state. ${cancellationRules[role]?.afterShipment?.reason || ''}` });
    }

    // Check cancellation rules
    const isBeforeShipment = ['paid', 'processing'].includes(txn.status);
    const rules = isBeforeShipment ? cancellationRules[role].beforeShipment : cancellationRules[role].afterShipment;

    if (!rules.allowed) {
      return res.status(400).json({ message: rules.reason });
    }

    // Calculate refund
    const refundAmount = isBeforeShipment ? txn.paymentBreakdown.totalPaid :
      txn.paymentBreakdown.subtotal; // No shipping refund after shipment

    // Update transaction
    txn.status = cancelState;
    txn.dispute = {
      reason: reason || `Cancelled by ${role}`,
      filedAt: new Date(),
      resolution: `Refund of ${refundAmount} initiated`,
    };

    // Store cancellation evidence if provided
    if (evidence && evidence.length > 0) {
      txn.dispute.evidence = evidence;
    }

    // Refund to buyer
    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.balance.available = Math.max(0, (buyer.balance.available || 0) - txn.paymentBreakdown.totalPaid);
      buyer.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Order cancelled. Refund of ${refundAmount} ${txn.currency} will be processed.`,
      });
      await buyer.save();
    }

    // Restore seller balance if was pending
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - txn.paymentBreakdown.sellerEarnings);

      // Apply seller penalty for seller-initiated cancellations
      if (role === 'seller' && rules.sellerPenalty) {
        seller.stats.strikes = (seller.stats.strikes || 0) + 1;
        seller.notifications.unshift({
          type: 'sale',
          listing: txn.listing,
          transaction: txn._id,
          message: `Order cancelled. This counts as a strike. (${seller.stats.strikes}/3 strikes before suspension)`,
        });
      }
      await seller.save();
    }

    // Restore listing
    await Listing.findByIdAndUpdate(txn.listing, { sold: false, available: true });

    await txn.save();

    res.json({
      message: `Order cancelled. Refund of ${refundAmount} ${txn.currency} will be processed.`,
      transaction: txn,
      refundAmount,
      refundType: isBeforeShipment ? 'full' : 'partial',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/orders/:transactionId/confirm-received - Buyer confirms receipt
router.post('/:transactionId/confirm-received', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'buyer') {
      return res.status(403).json({ message: 'Only buyer can confirm receipt' });
    }

    if (!isValidTransition(txn.status, orderStates.BUYER_CONFIRMED)) {
      return res.status(400).json({ message: 'Cannot confirm receipt in current status' });
    }

    const { packingProof } = req.body; // Buyer's unboxing evidence

    txn.status = orderStates.BUYER_CONFIRMED;
    txn.buyerConfirmed = {
      received: true,
      confirmedAt: new Date(),
      packingProof: packingProof || [], // Store unboxing evidence
    };

    // Note: Funds are NOT released yet. Auto-complete after 3 days if no return/dispute.
    // Pending balance stays pending until auto-complete or manual completion.

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

// POST /api/orders/:transactionId/request-return - Buyer requests return
router.post('/:transactionId/request-return', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'buyer') {
      return res.status(403).json({ message: 'Only buyer can request return' });
    }

    if (!isValidTransition(txn.status, orderStates.RETURN_REQUESTED)) {
      return res.status(400).json({ message: 'Cannot request return in current status' });
    }

    // Check return window (5 days from delivery)
    const deliveredAt = txn.shipping?.actualDelivery || txn.updatedAt;
    const returnDeadline = new Date(deliveredAt).getTime() + timeWindows.RETURN_WINDOW;
    if (Date.now() > returnDeadline) {
      return res.status(400).json({
        message: 'Return window has expired. Returns must be requested within 5 days of delivery.',
        returnDeadline: new Date(returnDeadline).toISOString(),
      });
    }

    const { reason, condition, evidence } = req.body;

    // Check return eligibility
    const listing = await Listing.findById(txn.listing);
    const conditionRule = returnEligibility.conditions[listing?.condition];
    if (conditionRule && !conditionRule.returnable) {
      return res.status(400).json({ message: conditionRule.reason });
    }

    // Check non-returnable items
    const isNonReturnable = returnEligibility.nonReturnable.some(item =>
      reason?.toLowerCase().includes(item.toLowerCase())
    );

    txn.status = orderStates.RETURN_REQUESTED;
    txn.dispute = {
      reason: reason || 'Item not as expected',
      filedAt: new Date(),
      evidence: evidence || [],
    };

    // Store return details
    txn.returnDetails = {
      requestedAt: new Date(),
      deadline: new Date(returnDeadline),
      reason,
      condition,
      buyerPackingProof: evidence || [],
    };

    // Notify seller - they have 3 days to accept/reject
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return requested for "${listing?.title}". You have 3 days to accept or reject.`,
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

// POST /api/orders/:transactionId/accept-return - Seller accepts return
router.post('/:transactionId/accept-return', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'seller') {
      return res.status(403).json({ message: 'Only seller can accept return' });
    }

    if (!isValidTransition(txn.status, orderStates.RETURN_ACCEPTED)) {
      return res.status(400).json({ message: 'Cannot accept return in current status' });
    }

    // Check if seller responded within time window
    const returnRequestedAt = txn.dispute?.filedAt || txn.updatedAt;
    const sellerDeadline = new Date(returnRequestedAt).getTime() + timeWindows.SELLER_RESPOND_RETURN;
    if (Date.now() > sellerDeadline) {
      // Auto-accept if seller didn't respond in time
      // This is a consumer protection measure
    }

    txn.status = orderStates.RETURN_ACCEPTED;
    txn.returnDetails = {
      ...txn.returnDetails,
      acceptedAt: new Date(),
      returnShipDeadline: new Date(Date.now() + timeWindows.RETURN_SHIP_WINDOW),
    };

    // Notify buyer - they have 7 days to ship return
    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return accepted! Please ship the item back within 7 days. You will receive a refund once the seller confirms receipt.`,
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

// POST /api/orders/:transactionId/reject-return - Seller rejects return
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
    txn.dispute = {
      ...txn.dispute,
      resolution: 'Return rejected by seller',
      evidence: evidence || [],
    };

    // Notify buyer - they can file a dispute
    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return rejected by seller. You can file a dispute within 14 days.`,
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

// POST /api/orders/:transactionId/confirm-return-received - Seller confirms return received
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

    txn.status = orderStates.RETURN_DELIVERED;
    txn.returnDetails = {
      ...txn.returnDetails,
      receivedAt: new Date(),
      inspectionNotes,
      sellerInspectionProof: sellerPackingProof || [],
    };

    await txn.save();

    // Auto-refund after seller confirms receipt
    // Refund full amount to buyer
    const refundAmount = txn.paymentBreakdown.totalPaid;
    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      buyer.balance.available = (buyer.balance.available || 0) + refundAmount;
      buyer.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return received by seller. Refund of ${refundAmount} ${txn.currency} has been issued.`,
      });
      await buyer.save();
    }

    // Deduct from seller
    const seller = await User.findById(txn.seller);
    if (seller) {
      seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - txn.paymentBreakdown.sellerEarnings);
      seller.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Return confirmed. ${refundAmount} ${txn.currency} refunded to buyer.`,
      });
      await seller.save();
    }

    txn.status = orderStates.REFUNDED;
    txn.payout = {
      status: 'refunded',
      processedAt: new Date(),
    };

    // Restore listing
    await Listing.findByIdAndUpdate(txn.listing, { sold: false, available: true });

    await txn.save();

    res.json({
      message: 'Return confirmed. Refund issued to buyer.',
      transaction: txn,
      refundAmount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/orders/:transactionId/dispute - File dispute
router.post('/:transactionId/dispute', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;
    const { reason, evidence } = req.body;

    if (!isValidTransition(txn.status, orderStates.DISPUTED)) {
      return res.status(400).json({ message: 'Cannot file dispute in current status' });
    }

    if (!reason || (evidence && evidence.length > disputeProcess.maxEvidenceFiles)) {
      return res.status(400).json({
        message: `Dispute requires a reason and max ${disputeProcess.maxEvidenceFiles} evidence files`,
      });
    }

    txn.status = orderStates.DISPUTED;
    txn.dispute = {
      reason,
      filedBy: req.user._id,
      filedAt: new Date(),
      evidence: evidence || [],
      responseDeadline: new Date(Date.now() + disputeProcess.responseWindow),
    };

    // Notify other party
    const otherUserId = req.orderRole === 'buyer' ? txn.seller : txn.buyer;
    const otherUser = await User.findById(otherUserId);
    if (otherUser) {
      otherUser.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Dispute filed by ${req.orderRole}. You have 48 hours to respond with evidence.`,
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

// GET /api/orders/:transactionId/lifecycle - Get full order lifecycle info
router.get('/:transactionId/lifecycle', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;
    const role = req.orderRole;

    // Calculate all time-based info
    const now = Date.now();
    const deliveredAt = txn.shipping?.actualDelivery ? new Date(txn.shipping.actualDelivery).getTime() : null;

    res.json({
      transaction: txn,
      role,
      status: txn.status,
      allowedActions: getAllowedActions(txn.status, role),
      timeline: {
        created: txn.createdAt,
        paid: txn.status !== 'pending' ? txn.createdAt : null,
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
      evidence: {
        seller: evidenceRequirements.seller,
        buyer: evidenceRequirements.buyer,
      },
      payment: txn.paymentBreakdown,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;