const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Payout = require('../models/Payout');
const Order = require('../models/Order');
const { isValidObjectId } = require('../utils/validators');
const { findPaymentIntent, issueRefund, releaseAuthorization } = require('../config/payments');
const { releaseSellerEarnings, reverseEscrowHold } = require('../utils/balances');

// ===================== ESCROW SERVICE =====================
// For high-value items (>$500), hold funds in escrow until both parties confirm satisfaction

// POST /api/escrow/initiate - Initiate escrow for a high-value transaction
router.post('/initiate', auth, async (req, res) => {
  try {
    const { transactionId, amount } = req.body;

    if (!transactionId || amount === undefined || amount === null) {
      return res.status(400).json({ message: 'transactionId and amount are required' });
    }
    if (!isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    // Only buyer can initiate escrow on their transaction
    if (String(transaction.buyer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only buyer can initiate escrow' });
    }
    
    // Check transaction value threshold (evaluated on the verified amount so
    // a mismatched amount is reported as a mismatch first, below).
    if (amount <= 500) {
      return res.status(400).json({ message: 'Escrow only available for items over $500' });
    }

    // The escrowed amount must match what the buyer actually paid — otherwise
    // a crafted request could lock (or later release) a different sum than
    // the money held for this transaction.
    const expectedAmount = transaction.paymentBreakdown?.totalPaid ?? transaction.amount;
    if (expectedAmount !== undefined && expectedAmount !== null && Number(amount) !== Number(expectedAmount)) {
      return res.status(400).json({ message: 'Escrow amount must match the transaction total paid' });
    }
    
    // Check if already in escrow
    if (transaction.escrow?.status === 'active') {
      return res.status(400).json({ message: 'Escrow already active for this transaction' });
    }
    
    // Initialize escrow
    transaction.escrow = {
      status: 'active',
      amount,
      initiatedAt: new Date(),
      releaseConditions: {
        buyerConfirmed: false,
        sellerConfirmed: false,
        inspectionPeriodDays: 7,
      },
    };
    
    await transaction.save();
    
    // Notify seller
    const seller = await User.findById(transaction.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'sale',
        listing: transaction.listing,
        transaction: transaction._id,
        message: 'Escrow initiated for this transaction. Funds will be held until both parties confirm satisfaction.',
      });
      await seller.save();
    }
    
    res.json({
      message: 'Escrow initiated successfully',
      transaction,
      estimatedReleaseDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Escrow initiate error:', error);
    res.status(500).json({ message: 'Failed to initiate escrow' });
  }
});

// Claim the release atomically. Exactly one confirmation request may win this
// transition; the winner alone is allowed to credit the seller.
const claimEscrowRelease = (transactionId) => Transaction.findOneAndUpdate(
  {
    _id: transactionId,
    'escrow.status': 'active',
    'escrow.releaseConditions.buyerConfirmed': true,
    'escrow.releaseConditions.sellerConfirmed': true,
  },
  { $set: { 'escrow.status': 'released', 'escrow.releasedAt': new Date() } },
  { new: true },
);

const creditReleasedEscrow = async (transaction) => {
  const sellerEarnings = transaction.paymentBreakdown?.sellerEarnings || 0;
  const seller = await User.findById(transaction.seller);
  if (!seller) return;
  const reserveAmount = Math.round(sellerEarnings * 0.10 * 100) / 100;
  const availableAmount = sellerEarnings - reserveAmount;
  seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - sellerEarnings);
  seller.balance.available = (seller.balance.available || 0) + availableAmount;
  seller.balance.totalEarned = (seller.balance.totalEarned || 0) + sellerEarnings;
  seller.balance.reserve = (seller.balance.reserve || 0) + reserveAmount;
  seller.balance.reserveReleaseDate = seller.balance.reserveReleaseDate || [];
  seller.balance.reserveReleaseDate.push({
    amount: reserveAmount,
    releaseDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    transactionId: transaction._id,
  });
  seller.notifications.unshift({
    type: 'sale', listing: transaction.listing, transaction: transaction._id,
    message: `Escrow released! ${availableAmount} ${transaction.currency} added to your account. ${reserveAmount} ${transaction.currency} held in reserve.`,
  });
  await seller.save();
};

// POST /api/escrow/confirm-buyer - Buyer confirms satisfaction with item
router.post('/confirm-buyer', auth, async (req, res) => {
  try {
    const { transactionId } = req.body;
    
    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'transactionId is required' });
    }
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    // Only buyer can confirm
    if (String(transaction.buyer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only buyer can confirm' });
    }
    
    // Check escrow is active
    if (transaction.escrow?.status !== 'active') {
      return res.status(400).json({ message: 'Escrow not active for this transaction' });
    }
    
    const updated = await Transaction.findOneAndUpdate(
      { _id: transaction._id, 'escrow.status': 'active' },
      { $set: { 'escrow.releaseConditions.buyerConfirmed': true } },
      { new: true },
    );
    if (!updated) return res.status(400).json({ message: 'Escrow is already being settled or has completed' });

    const released = await claimEscrowRelease(transaction._id);
    if (released) await creditReleasedEscrow(released);
    const responseTransaction = released || updated;

    res.json({
      message: responseTransaction.escrow.status === 'released'
        ? 'Both parties confirmed. Escrow released to seller.'
        : 'Buyer confirmation recorded. Waiting for seller confirmation.',
      transaction: responseTransaction,
    });
  } catch (error) {
    console.error('Escrow buyer confirm error:', error);
    res.status(500).json({ message: 'Failed to confirm escrow' });
  }
});

// POST /api/escrow/confirm-seller - Seller confirms satisfaction with transaction
router.post('/confirm-seller', auth, async (req, res) => {
  try {
    const { transactionId } = req.body;
    
    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'transactionId is required' });
    }
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    // Only seller can confirm
    if (String(transaction.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only seller can confirm' });
    }
    
    // Check escrow is active
    if (transaction.escrow?.status !== 'active') {
      return res.status(400).json({ message: 'Escrow not active for this transaction' });
    }
    
    const updated = await Transaction.findOneAndUpdate(
      { _id: transaction._id, 'escrow.status': 'active' },
      { $set: { 'escrow.releaseConditions.sellerConfirmed': true } },
      { new: true },
    );
    if (!updated) return res.status(400).json({ message: 'Escrow is already being settled or has completed' });

    const released = await claimEscrowRelease(transaction._id);
    if (released) await creditReleasedEscrow(released);
    const responseTransaction = released || updated;

    res.json({
      message: responseTransaction.escrow.status === 'released'
        ? 'Both parties confirmed. Escrow released to seller.'
        : 'Seller confirmation recorded. Waiting for buyer confirmation.',
      transaction: responseTransaction,
    });
  } catch (error) {
    console.error('Escrow seller confirm error:', error);
    res.status(500).json({ message: 'Failed to confirm escrow' });
  }
});

// POST /api/escrow/dispute - File dispute during escrow period
router.post('/dispute', auth, async (req, res) => {
  try {
    const { transactionId, reason, evidence } = req.body;
    
    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'transactionId is required' });
    }
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    // Only buyer can dispute
    if (String(transaction.buyer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only buyer can dispute escrow' });
    }
    
    // Check escrow is active
    if (transaction.escrow?.status !== 'active') {
      return res.status(400).json({ message: 'Escrow not active for this transaction' });
    }
    
    if (!reason) {
      return res.status(400).json({ message: 'Dispute reason is required' });
    }
    
    transaction.escrow.status = 'disputed';
    transaction.escrow.dispute = {
      reason,
      evidence: evidence || [],
      disputedAt: new Date(),
      disputedBy: req.user._id,
    };
    
    // Notify seller
    const seller = await User.findById(transaction.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'sale',
        listing: transaction.listing,
        transaction: transaction._id,
        message: `Escrow disputed: ${reason}. Please respond within 48 hours.`,
      });
      await seller.save();
    }
    
    await transaction.save();
    
    res.json({
      message: 'Escrow disputed. Seller has been notified.',
      transaction,
    });
  } catch (error) {
    console.error('Escrow dispute error:', error);
    res.status(500).json({ message: 'Failed to dispute escrow' });
  }
});

// POST /api/escrow/resolve-dispute - Admin resolves escrow dispute
router.post('/resolve-dispute', auth, async (req, res) => {
  try {
    const { transactionId, resolution } = req.body;
    
    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'transactionId is required' });
    }
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    // Only admin can resolve disputes
    const user = await User.findById(req.user._id);
    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can resolve escrow disputes' });
    }
    
    // Resolution is a money-moving state transition. Validate it before
    // touching the transaction so malformed admin input cannot create a
    // terminal state with no settlement.
    if (!['release_to_buyer', 'release_to_seller'].includes(resolution)) {
      return res.status(400).json({ message: 'Invalid escrow resolution' });
    }
    if (transaction.escrow?.status !== 'disputed') {
      return res.status(400).json({ message: 'Escrow not in disputed state' });
    }

    const paymentIntentId = transaction.paymentBreakdown?.paymentIntentId
      || transaction.payout?.transactionId;
    const refundAmount = Number(transaction.paymentBreakdown?.totalPaid || 0);
    const sellerEarnings = Number(transaction.paymentBreakdown?.sellerEarnings || 0);
    const quantity = Number.isInteger(transaction.quantity) && transaction.quantity > 0 ? transaction.quantity : 1;

    // Settle with the provider before mutating the ledger. If Stripe rejects
    // the refund/release, the dispute remains retryable and no local balance,
    // inventory, payout, or transaction state is changed.
    if (resolution === 'release_to_buyer') {
      try {
        const paymentIntent = paymentIntentId ? await findPaymentIntent(paymentIntentId) : null;
        if (!paymentIntent) {
          return res.status(502).json({ message: 'Payment provider reference could not be verified' });
        }
        if (paymentIntent.status === 'requires_capture') {
          await releaseAuthorization(paymentIntentId);
        } else if (paymentIntentId) {
          await issueRefund(paymentIntentId);
        } else {
          return res.status(502).json({ message: 'Payment provider reference is missing' });
        }
      } catch (providerError) {
        console.error('Escrow dispute refund error:', providerError.message);
        return res.status(502).json({ message: 'Escrow refund could not be processed. No ledger changes were made.' });
      }

      await reverseEscrowHold(transaction.seller, sellerEarnings);
      await Listing.findOneAndUpdate(
        { _id: transaction.listing },
        {
          $inc: { quantity, quantitySold: -quantity },
          $set: { available: true, sold: false },
        },
        { new: true },
      );
      await Payout.updateMany(
        { transaction: transaction._id, status: { $ne: 'refunded' } },
        { $set: { status: 'refunded', refundedAt: new Date() } },
      );
      transaction.status = 'refunded';
      if (transaction.payout) transaction.payout.status = 'refunded';
      transaction.cancellation = {
        cancelledBy: 'admin',
        reason: 'Escrow dispute resolved in favor of buyer',
        cancelledAt: new Date(),
        refundAmount,
      };
    } else {
      const reserveAmount = Math.round(sellerEarnings * 0.10 * 100) / 100;
      const availableAmount = Math.round((sellerEarnings - reserveAmount) * 100) / 100;
      await releaseSellerEarnings(transaction.seller, {
        earnings: sellerEarnings,
        availableAmount,
        reserveAmount,
        // Exactly-once: a retried dispute resolution (or a double-clicked
        // resolve button) must not release the escrow a second time.
        settlementKey: transaction._id,
        reserveRelease: {
          amount: reserveAmount,
          releaseDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          transactionId: transaction._id,
        },
      });
      await Payout.updateMany(
        { transaction: transaction._id, status: { $nin: ['completed', 'refunded'] } },
        { $set: { status: 'completed', paidAt: new Date() } },
      );
      transaction.status = 'completed';
      if (transaction.payout) transaction.payout.status = 'completed';
    }

    transaction.escrow.status = 'resolved';
    transaction.escrow.resolution = resolution;
    transaction.escrow.resolvedAt = new Date();
    transaction.escrow.resolvedBy = req.user._id;
    await transaction.save();

    // Keep consolidated order state aligned with the underlying transaction.
    // Otherwise a refunded escrow item can remain visible as an active order
    // and a completed dispute can keep funds marked as held at order level.
    const orders = await Order.find({ 'items.transaction': transaction._id });
    for (const order of orders) {
      if (resolution === 'release_to_buyer') {
        order.items = (order.items || []).filter((item) => String(item.transaction) !== String(transaction._id));
        (order.shipments || []).forEach((shipment) => {
          shipment.items = (shipment.items || []).filter((id) => String(id) !== String(transaction._id));
          if (shipment.items.length === 0) shipment.status = 'cancelled';
        });
        order.cancellation = {
          cancelledBy: 'admin',
          reason: 'Escrow dispute resolved in favor of buyer',
          cancelledAt: new Date(),
          refundAmount: Math.round(((order.cancellation?.refundAmount || 0) + refundAmount) * 100) / 100,
          currency: transaction.currency || order.currency || 'USD',
        };
        if (order.items.length === 0) {
          order.status = 'refunded';
          if (order.payment) order.payment.status = 'refunded';
        }
      } else {
        const transactionIds = (order.items || []).map((item) => item.transaction).filter(Boolean);
        const remaining = await Transaction.countDocuments({ _id: { $in: transactionIds }, status: { $nin: ['completed'] } });
        if (remaining === 0) {
          order.status = 'completed';
          if (order.payment) order.payment.status = 'captured';
        }
      }
      await order.save();
    }

    res.json({
      message: `Escrow dispute resolved: ${resolution}`,
      transaction,
    });
  } catch (error) {
    console.error('Escrow resolve dispute error:', error);
    res.status(500).json({ message: 'Failed to resolve escrow dispute' });
  }
});

// GET /api/escrow/settings - Get escrow configuration
router.get('/settings', (req, res) => {
  res.json({
    threshold: 500, // USD - minimum amount for escrow eligibility
    inspectionPeriodDays: 7,
    disputeWindowHours: 48,
    releaseConditions: {
      bothPartiesConfirmed: true,
      adminResolution: true,
    },
  });
});

module.exports = router;