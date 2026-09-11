const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Return = require('../models/Return');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { orderStates, isValidTransition } = require('../config/orderLifecycle');
const { reverseBoostFeeOwed, markPayoutRefunded, syncOrderFromTransaction } = require('./orderLifecycle');

// POST /api/returns - Create a return request (buyer only)
router.post('/', auth, async (req, res) => {
  try {
    const { transactionId, reason, description } = req.body;
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    if (transaction.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (!['completed', 'delivered'].includes(transaction.status)) {
      return res.status(400).json({ message: 'Transaction must be completed before returning' });
    }
    if (!isValidTransition(transaction.status, orderStates.RETURN_REQUESTED)) {
      return res.status(400).json({ message: 'Cannot request return from current order status' });
    }
    const existing = await Return.findOne({ transaction: transactionId });
    if (existing) return res.status(400).json({ message: 'Return already exists for this transaction' });
    const refundAmount = transaction.itemPrice || transaction.paymentBreakdown?.subtotal || 0;
    const returnRequest = await Return.create({
      transaction: transactionId, buyer: req.user._id, seller: transaction.seller,
      listing: transaction.listing, reason, description: description || '', refundAmount,
    });
    // Sync to Transaction lifecycle
    transaction.status = orderStates.RETURN_REQUESTED;
    transaction.returnDetails = {
      ...transaction.returnDetails, reason, description: description || '',
      requestedAt: new Date(), returnId: returnRequest._id,
    };
    await transaction.save();
    try {
      const seller = await User.findById(transaction.seller);
      if (seller) {
        seller.notifications.push({ type: 'sale', from: req.user._id, listing: transaction.listing, message: `Return requested: ${reason}`, read: false });
        await seller.save();
      }
    } catch (e) { console.error('Notify seller return request:', e.message); }
    res.status(201).json(returnRequest);
  } catch (error) {
    console.error('Create return error:', error);
    res.status(500).json({ message: 'Failed to create return request' });
  }
});

// GET /api/returns - Get returns for current user (buyer or seller)
router.get('/', auth, async (req, res) => {
  try {
    const returns = await Return.find({ $or: [{ buyer: req.user._id }, { seller: req.user._id }] })
      .populate('listing', 'title images price').populate('buyer', 'name avatar')
      .populate('seller', 'name avatar').sort({ createdAt: -1 });
    res.json(returns);
  } catch (error) {
    console.error('Get returns error:', error);
    res.status(500).json({ message: 'Failed to fetch returns' });
  }
});

// GET /api/returns/:id - Get single return details
router.get('/:id', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id)
      .populate('listing', 'title images price').populate('buyer', 'name avatar').populate('seller', 'name avatar');
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    const userId = req.user._id.toString();
    if (returnRequest.buyer._id.toString() !== userId && returnRequest.seller._id.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    res.json(returnRequest);
  } catch (error) {
    console.error('Get return error:', error);
    res.status(500).json({ message: 'Failed to fetch return' });
  }
});

// PUT /api/returns/:id/approve - Seller approves return request
router.put('/:id/approve', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    if (returnRequest.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (returnRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Return is not in pending status' });
    }
    returnRequest.status = 'approved';
    await returnRequest.save();
    // Sync to Transaction lifecycle
    const txn = await Transaction.findById(returnRequest.transaction);
    if (txn && isValidTransition(txn.status, orderStates.RETURN_ACCEPTED)) {
      txn.status = orderStates.RETURN_ACCEPTED;
      txn.returnDetails = { ...txn.returnDetails, approvedAt: new Date() };
      await txn.save();
    }
    try {
      const buyer = await User.findById(returnRequest.buyer);
      if (buyer) {
        buyer.notifications.push({ type: 'sale', from: req.user._id, listing: returnRequest.listing, message: 'Your return request has been approved. Please ship the item back.', read: false });
        await buyer.save();
      }
    } catch (e) { console.error('Notify buyer approve:', e.message); }
    res.json(returnRequest);
  } catch (error) {
    console.error('Approve return error:', error);
    res.status(500).json({ message: 'Failed to approve return' });
  }
});

// PUT /api/returns/:id/deny - Seller denies return request
router.put('/:id/deny', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    if (returnRequest.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (returnRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Return is not in pending status' });
    }
    returnRequest.status = 'denied';
    returnRequest.denialReason = req.body.reason || 'Return denied by seller';
    await returnRequest.save();
    // Sync to Transaction lifecycle
    const txn = await Transaction.findById(returnRequest.transaction);
    if (txn && isValidTransition(txn.status, orderStates.RETURN_REJECTED)) {
      txn.status = orderStates.RETURN_REJECTED;
      txn.returnDetails = { ...txn.returnDetails, rejectedAt: new Date(), rejectionReason: returnRequest.denialReason };
      await txn.save();
      try { await syncOrderFromTransaction(txn, orderStates.RETURN_REJECTED); } catch {}
    }
    try {
      const buyer = await User.findById(returnRequest.buyer);
      if (buyer) {
        buyer.notifications.push({ type: 'sale', from: req.user._id, listing: returnRequest.listing, message: `Your return request has been denied: ${returnRequest.denialReason}`, read: false });
        await buyer.save();
      }
    } catch (e) { console.error('Notify buyer deny:', e.message); }
    res.json(returnRequest);
  } catch (error) {
    console.error('Deny return error:', error);
    res.status(500).json({ message: 'Failed to deny return' });
  }
});

// PUT /api/returns/:id/ship - Buyer ships return item back
router.put('/:id/ship', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    if (returnRequest.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (returnRequest.status !== 'approved') {
      return res.status(400).json({ message: 'Return must be approved before shipping' });
    }
    returnRequest.status = 'shipped';
    returnRequest.trackingNumber = req.body.trackingNumber || '';
    await returnRequest.save();
    // Sync to Transaction lifecycle
    const txn = await Transaction.findById(returnRequest.transaction);
    if (txn && isValidTransition(txn.status, orderStates.RETURN_IN_TRANSIT)) {
      txn.status = orderStates.RETURN_IN_TRANSIT;
      txn.returnDetails = { ...txn.returnDetails, shippedAt: new Date(), buyerShippedAt: new Date(), trackingNumber: returnRequest.trackingNumber };
      await txn.save();
    }
    try {
      const seller = await User.findById(returnRequest.seller);
      if (seller) {
        seller.notifications.push({ type: 'shipping', from: req.user._id, listing: returnRequest.listing, message: `Return item shipped. Tracking: ${returnRequest.trackingNumber}`, read: false });
        await seller.save();
      }
    } catch (e) { console.error('Notify seller ship:', e.message); }
    res.json(returnRequest);
  } catch (error) {
    console.error('Ship return error:', error);
    res.status(500).json({ message: 'Failed to ship return' });
  }
});

// PUT /api/returns/:id/receive - Seller confirms return received and processes refund
// FULL refund semantics: restore listing, reverse boost fee, claw back seller balance,
// mark payout refunded, issue Stripe refund, sync to Transaction lifecycle.
router.put('/:id/receive', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    if (returnRequest.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (returnRequest.status !== 'shipped') {
      return res.status(400).json({ message: 'Return must be shipped before receiving' });
    }
    const txn = await Transaction.findById(returnRequest.transaction);
    if (!txn) return res.status(404).json({ message: 'Associated transaction not found' });

    // Restore listing inventory - exact quantity bought
    try {
      await Listing.findByIdAndUpdate(txn.listing, {
        $inc: { quantity: txn.quantity || 1, quantitySold: -(txn.quantity || 1) },
        $set: { sold: false, available: true },
      });
    } catch (listingErr) { console.error('Restore listing on receive:', listingErr.message); }

    // Reverse boost fee + mark payout refunded
    await reverseBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
    await markPayoutRefunded(txn);

    const refundAmount = txn.paymentBreakdown?.totalPaid || 0;
    const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;

    // Issue Stripe refund to original payment method
    const paymentIntentId = txn.payout?.transactionId;
    if (paymentIntentId) {
      try {
        const { retrievePaymentIntent, issueRefund, releaseAuthorization } = require('../config/payments');
        const pi = await retrievePaymentIntent(paymentIntentId);
        if (pi.status === 'succeeded') { await issueRefund(paymentIntentId); }
        else if (pi.status === 'requires_capture') { await releaseAuthorization(paymentIntentId); }
      } catch (stripeErr) { console.error('Stripe refund on receive:', stripeErr.message); }
    }

    // Claw back seller earnings from available or pending balance
    try {
      const seller = await User.findById(txn.seller);
      if (seller && seller.balance) {
        const available = seller.balance.available || 0;
        const pending = seller.balance.pending || 0;
        let remaining = sellerEarnings;
        if (available >= remaining) { seller.balance.available = available - remaining; remaining = 0; }
        else { seller.balance.available = 0; remaining = remaining - available; }
        if (remaining > 0) { seller.balance.pending = Math.max(0, pending - remaining); }
        seller.balance.totalEarned = Math.max(0, (seller.balance.totalEarned || 0) - sellerEarnings);
        seller.notifications.unshift({ type: 'sale', listing: txn.listing, transaction: txn._id, message: `Return received and confirmed. ${refundAmount} ${txn.currency || 'USD'} refunded to buyer.` });
        await seller.save();
      }
    } catch (sellerErr) { console.error('Claw back seller earnings:', sellerErr.message); }

    // Update Return model + sync Transaction to REFUNDED
    returnRequest.status = 'refunded';
    await returnRequest.save();
    if (isValidTransition(txn.status, orderStates.REFUNDED)) {
      txn.status = orderStates.REFUNDED;
      txn.returnDetails = { ...txn.returnDetails, receivedAt: new Date(), inspectionNotes: req.body.inspectionNotes || '' };
      txn.payout = { status: 'refunded', processedAt: new Date() };
      await txn.save();
      try { await syncOrderFromTransaction(txn, orderStates.REFUNDED); } catch {}
    }

    try {
      const buyer = await User.findById(returnRequest.buyer);
      if (buyer) {
        buyer.notifications.push({ type: 'payout', from: req.user._id, listing: returnRequest.listing, message: `Your return has been processed. Refund of $${returnRequest.refundAmount.toFixed(2)} will be issued.`, read: false });
        await buyer.save();
      }
    } catch (e) { console.error('Notify buyer refund:', e.message); }

    res.json(returnRequest);
  } catch (error) {
    console.error('Receive return error:', error);
    res.status(500).json({ message: 'Failed to receive return' });
  }
});

module.exports = router;
