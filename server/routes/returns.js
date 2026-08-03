const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Return = require('../models/Return');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

// POST /api/returns - Create a return request (buyer only)
router.post('/', auth, async (req, res) => {
  try {
    const { transactionId, reason, description } = req.body;

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Verify buyer owns this transaction
    if (transaction.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Check transaction is completed/delivered
    if (!['completed', 'delivered'].includes(transaction.status)) {
      return res.status(400).json({ message: 'Transaction must be completed before returning' });
    }

    // Check for existing return on this transaction
    const existing = await Return.findOne({ transaction: transactionId });
    if (existing) {
      return res.status(400).json({ message: 'Return already exists for this transaction' });
    }

    // Refund the full item price (buyer protection fees are refunded by the platform)
    const refundAmount = transaction.itemPrice || transaction.paymentBreakdown?.subtotal || 0;

    const returnRequest = await Return.create({
      transaction: transactionId,
      buyer: req.user._id,
      seller: transaction.seller,
      listing: transaction.listing,
      reason,
      description: description || '',
      refundAmount,
    });

    // Notify seller
    const seller = await User.findById(transaction.seller);
    if (seller) {
      seller.notifications.push({
        type: 'sale', // reuse sale type for return notifications
        from: req.user._id,
        listing: transaction.listing,
        message: `Return requested: ${reason}`,
        read: false,
      });
      await seller.save();
    }

    res.status(201).json(returnRequest);
  } catch (error) {
    console.error('Create return error:', error);
    res.status(500).json({ message: 'Failed to create return request' });
  }
});

// GET /api/returns - Get returns for current user (buyer or seller)
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const returns = await Return.find({
      $or: [{ buyer: userId }, { seller: userId }],
    })
      .populate('listing', 'title images price')
      .populate('buyer', 'name avatar')
      .populate('seller', 'name avatar')
      .sort({ createdAt: -1 });

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
      .populate('listing', 'title images price')
      .populate('buyer', 'name avatar')
      .populate('seller', 'name avatar');

    if (!returnRequest) {
      return res.status(404).json({ message: 'Return not found' });
    }

    // Only buyer or seller can view
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

// PUT /api/returns/:id/approve - Seller approves return
router.put('/:id/approve', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) {
      return res.status(404).json({ message: 'Return not found' });
    }

    if (returnRequest.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (returnRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Return is not in pending status' });
    }

    returnRequest.status = 'approved';
    await returnRequest.save();

    // Notify buyer
    const buyer = await User.findById(returnRequest.buyer);
    if (buyer) {
      buyer.notifications.push({
        type: 'shipping',
        from: req.user._id,
        listing: returnRequest.listing,
        message: 'Your return has been approved. Please ship the item back.',
        read: false,
      });
      await buyer.save();
    }

    res.json(returnRequest);
  } catch (error) {
    console.error('Approve return error:', error);
    res.status(500).json({ message: 'Failed to approve return' });
  }
});

// PUT /api/returns/:id/deny - Seller denies return
router.put('/:id/deny', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) {
      return res.status(404).json({ message: 'Return not found' });
    }

    if (returnRequest.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (returnRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Return is not in pending status' });
    }

    returnRequest.status = 'denied';
    returnRequest.denialReason = req.body.reason || 'Return denied by seller';
    await returnRequest.save();

    // Notify buyer
    const buyer = await User.findById(returnRequest.buyer);
    if (buyer) {
      buyer.notifications.push({
        type: 'sale',
        from: req.user._id,
        listing: returnRequest.listing,
        message: `Your return request has been denied: ${returnRequest.denialReason}`,
        read: false,
      });
      await buyer.save();
    }

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
    if (!returnRequest) {
      return res.status(404).json({ message: 'Return not found' });
    }

    if (returnRequest.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (returnRequest.status !== 'approved') {
      return res.status(400).json({ message: 'Return must be approved before shipping' });
    }

    returnRequest.status = 'shipped';
    returnRequest.trackingNumber = req.body.trackingNumber || '';
    await returnRequest.save();

    // Notify seller
    const seller = await User.findById(returnRequest.seller);
    if (seller) {
      seller.notifications.push({
        type: 'shipping',
        from: req.user._id,
        listing: returnRequest.listing,
        message: `Return item shipped. Tracking: ${returnRequest.trackingNumber}`,
        read: false,
      });
      await seller.save();
    }

    res.json(returnRequest);
  } catch (error) {
    console.error('Ship return error:', error);
    res.status(500).json({ message: 'Failed to ship return' });
  }
});

// PUT /api/returns/:id/receive - Seller confirms return received and processes refund
router.put('/:id/receive', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) {
      return res.status(404).json({ message: 'Return not found' });
    }

    if (returnRequest.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (returnRequest.status !== 'shipped') {
      return res.status(400).json({ message: 'Return must be shipped before receiving' });
    }

    returnRequest.status = 'refunded';
    await returnRequest.save();

    // Notify buyer of refund
    const buyer = await User.findById(returnRequest.buyer);
    if (buyer) {
      buyer.notifications.push({
        type: 'payout',
        from: req.user._id,
        listing: returnRequest.listing,
        message: `Your return has been processed. Refund of $${returnRequest.refundAmount.toFixed(2)} will be issued.`,
        read: false,
      });
      await buyer.save();
    }

    res.json(returnRequest);
  } catch (error) {
    console.error('Receive return error:', error);
    res.status(500).json({ message: 'Failed to receive return' });
  }
});

module.exports = router;