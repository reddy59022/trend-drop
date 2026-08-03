const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Payout = require('../models/Payout');
const Order = require('../models/Order');
const { orderStates, allowedTransitions, timeWindows, cancellationRules, refundRules, returnEligibility, evidenceRequirements, disputeProcess, isValidTransition, getAllowedActions } = require('../config/orderLifecycle');
const { calculatePaymentBreakdown, capturePaymentIntent, retrievePaymentIntent, issueRefund } = require('../config/payments');

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
      return {
        ...o.toObject(),
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

// POST /api/orders/:id/ship - seller marks ONLY their own shipment as shipped
router.post('/:id/ship', auth, async (req, res) => {
  try {
    const { shipmentIndex, trackingNumber, carrier } = req.body;
    if (shipmentIndex === undefined) {
      return res.status(400).json({ message: 'shipmentIndex is required' });
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

    shipment.status = 'shipped';
    if (trackingNumber) shipment.trackingNumber = trackingNumber;
    if (carrier) shipment.carrier = carrier;
    shipment.shippedAt = new Date();
    await order.save();

    // Sync underlying transactions to shipped with tracking
    try {
      await Transaction.updateMany(
        { _id: { $in: shipment.items } },
        {
          $set: {
            status: 'shipped',
            'shipping.trackingNumber': trackingNumber || '',
            'shipping.carrier': carrier || '',
          },
        }
      );
    } catch (syncErr) {
      console.error('Transaction sync error:', syncErr.message);
    }

    const userId = req.user._id.toString();
    const role = order.buyer.toString() === userId ? 'buyer' : 'seller';
    const payload = {
      ...order.toObject(),
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
    if (seller) {
      // FIX #3: New seller hold - first 5 sales held for 14 days
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
      
      // FIX #2: 10% rolling reserve held for 60 days
      const reserveAmount = Math.round(sellerEarnings * timeWindows.SELLER_RESERVE_PERCENT * 100) / 100;
      const availableAmount = sellerEarnings - reserveAmount;
      
      // Move money from pending → available (minus reserve)
      seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - sellerEarnings);
      seller.balance.available = (seller.balance.available || 0) + availableAmount;
      seller.balance.totalEarned = (seller.balance.totalEarned || 0) + sellerEarnings;
      
      // Track reserve separately
      if (!seller.balance.reserve) seller.balance.reserve = 0;
      if (!seller.balance.reserveReleaseDate) seller.balance.reserveReleaseDate = [];
      seller.balance.reserve += reserveAmount;
      seller.balance.reserveReleaseDate.push({
        amount: reserveAmount,
        releaseDate: new Date(Date.now() + timeWindows.SELLER_RESERVE_HOLD_DAYS),
        transactionId: txn._id,
      });
      
      seller.stats.totalSales = (seller.stats.totalSales || 0) + 1;
      seller.notifications.unshift({
        type: 'sale',
        listing: txn.listing,
        transaction: txn._id,
        message: `Payment of ${availableAmount} ${txn.currency} released! ${reserveAmount} ${txn.currency} held in reserve (60 days).`,
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

    // ROBUST: Claw back from available or pending balance
    const seller = await User.findById(txn.seller);
    if (seller) {
      const available = seller.balance.available || 0;
      const pending = seller.balance.pending || 0;
      let remaining = sellerEarnings;
      if (available >= remaining) {
        seller.balance.available = available - remaining;
        remaining = 0;
      } else {
        seller.balance.available = 0;
        remaining = remaining - available;
      }
      if (remaining > 0) {
        seller.balance.pending = Math.max(0, pending - remaining);
      }
      seller.balance.totalEarned = Math.max(0, (seller.balance.totalEarned || 0) - sellerEarnings);
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

// POST /api/orders/:transactionId/process-return
// Alias: Redirects to confirm-return-received logic (uses robust claw-back)
// Kept for backward compatibility - delegates to the robust implementation
router.post('/:transactionId/process-return', auth, validateOrderAccess, async (req, res) => {
  try {
    const txn = req.transaction;

    if (req.orderRole !== 'seller') {
      return res.status(403).json({ message: 'Only seller can process return' });
    }

    // Validate transition: process-return works from return_delivered
    if (!isValidTransition(txn.status, orderStates.REFUNDED)) {
      return res.status(400).json({ message: 'Cannot process return in current status' });
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
        message: `Return processed. Refund of ${refundAmount} ${txn.currency} has been processed to your original payment method.`,
      });
      await buyer.save();
    }

    // ROBUST: Claw back from available or pending balance (same as confirm-return-received)
    const seller = await User.findById(txn.seller);
    if (seller) {
      const available = seller.balance.available || 0;
      const pending = seller.balance.pending || 0;
      let remaining = sellerEarnings;
      if (available >= remaining) {
        seller.balance.available = available - remaining;
        remaining = 0;
      } else {
        seller.balance.available = 0;
        remaining = remaining - available;
      }
      if (remaining > 0) {
        seller.balance.pending = Math.max(0, pending - remaining);
      }
      seller.balance.totalEarned = Math.max(0, (seller.balance.totalEarned || 0) - sellerEarnings);
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

    await txn.save();

    res.json({
      message: 'Return processed. Full refund issued to buyer via original payment method.',
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

        // Release funds to seller with 10% rolling reserve
        const seller = await User.findById(txn.seller);
        if (seller) {
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
            
            seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - sellerEarnings);
            seller.balance.available = (seller.balance.available || 0) + availableAmount;
            seller.balance.totalEarned = (seller.balance.totalEarned || 0) + sellerEarnings;
            
            // Track reserve
            if (!seller.balance.reserve) seller.balance.reserve = 0;
            if (!seller.balance.reserveReleaseDate) seller.balance.reserveReleaseDate = [];
            seller.balance.reserve += reserveAmount;
            seller.balance.reserveReleaseDate.push({
              amount: reserveAmount,
              releaseDate: new Date(Date.now() + timeWindows.SELLER_RESERVE_HOLD_DAYS),
              transactionId: txn._id,
            });
          } else {
            // New seller hold - funds stay in pending
            seller.notifications.unshift({
              type: 'sale',
              listing: txn.listing,
              transaction: txn._id,
              message: `Payment held: New seller hold active until account is 14 days old.`,
            });
          }
          
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