const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');

// ===================== ESCROW SERVICE =====================
// For high-value items (>$500), hold funds in escrow until both parties confirm satisfaction

// POST /api/escrow/initiate - Initiate escrow for a high-value transaction
router.post('/initiate', auth, async (req, res) => {
  try {
    const { transactionId, amount } = req.body;
    
    if (!transactionId || !amount) {
      return res.status(400).json({ message: 'transactionId and amount are required' });
    }
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    // Only buyer can initiate escrow on their transaction
    if (String(transaction.buyer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only buyer can initiate escrow' });
    }
    
    // Check transaction value threshold
    if (amount <= 500) {
      return res.status(400).json({ message: 'Escrow only available for items over $500' });
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

// POST /api/escrow/confirm-buyer - Buyer confirms satisfaction with item
router.post('/confirm-buyer', auth, async (req, res) => {
  try {
    const { transactionId } = req.body;
    
    if (!transactionId) {
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
    
    transaction.escrow.releaseConditions.buyerConfirmed = true;
    
    // Check if both parties confirmed - release funds
    if (transaction.escrow.releaseConditions.sellerConfirmed) {
      transaction.escrow.status = 'released';
      transaction.escrow.releasedAt = new Date();
      
      // Release to seller (with normal platform fee and reserve)
      const sellerEarnings = transaction.paymentBreakdown?.sellerEarnings || 0;
      const seller = await User.findById(transaction.seller);
      if (seller) {
        const reserveAmount = Math.round(sellerEarnings * 0.10 * 100) / 100;
        const availableAmount = sellerEarnings - reserveAmount;
        
        seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - sellerEarnings);
        seller.balance.available = (seller.balance.available || 0) + availableAmount;
        seller.balance.totalEarned = (seller.balance.totalEarned || 0) + sellerEarnings;
        
        if (!seller.balance.reserve) seller.balance.reserve = 0;
        if (!seller.balance.reserveReleaseDate) seller.balance.reserveReleaseDate = [];
        seller.balance.reserve += reserveAmount;
        seller.balance.reserveReleaseDate.push({
          amount: reserveAmount,
          releaseDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          transactionId: transaction._id,
        });
        
        seller.notifications.unshift({
          type: 'sale',
          listing: transaction.listing,
          transaction: transaction._id,
          message: `Escrow released! ${availableAmount} ${transaction.currency} added to your account. ${reserveAmount} ${transaction.currency} held in reserve.`,
        });
        await seller.save();
      }
    }
    
    await transaction.save();
    
    res.json({
      message: transaction.escrow.status === 'released' 
        ? 'Both parties confirmed. Escrow released to seller.' 
        : 'Buyer confirmation recorded. Waiting for seller confirmation.',
      transaction,
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
    
    if (!transactionId) {
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
    
    transaction.escrow.releaseConditions.sellerConfirmed = true;
    
    // Check if both parties confirmed - release funds
    if (transaction.escrow.releaseConditions.buyerConfirmed) {
      transaction.escrow.status = 'released';
      transaction.escrow.releasedAt = new Date();
      
      // Release to seller
      const sellerEarnings = transaction.paymentBreakdown?.sellerEarnings || 0;
      const seller = await User.findById(transaction.seller);
      if (seller) {
        const reserveAmount = Math.round(sellerEarnings * 0.10 * 100) / 100;
        const availableAmount = sellerEarnings - reserveAmount;
        
        seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - sellerEarnings);
        seller.balance.available = (seller.balance.available || 0) + availableAmount;
        seller.balance.totalEarned = (seller.balance.totalEarned || 0) + sellerEarnings;
        
        if (!seller.balance.reserve) seller.balance.reserve = 0;
        if (!seller.balance.reserveReleaseDate) seller.balance.reserveReleaseDate = [];
        seller.balance.reserve += reserveAmount;
        seller.balance.reserveReleaseDate.push({
          amount: reserveAmount,
          releaseDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          transactionId: transaction._id,
        });
        
        seller.notifications.unshift({
          type: 'sale',
          listing: transaction.listing,
          transaction: transaction._id,
          message: `Escrow released! ${availableAmount} ${transaction.currency} added to your account. ${reserveAmount} ${transaction.currency} held in reserve.`,
        });
        await seller.save();
      }
    }
    
    await transaction.save();
    
    res.json({
      message: transaction.escrow.status === 'released' 
        ? 'Both parties confirmed. Escrow released to seller.' 
        : 'Seller confirmation recorded. Waiting for buyer confirmation.',
      transaction,
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
    
    if (!transactionId) {
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
    const { transactionId, resolution, releaseTo } = req.body;
    
    if (!transactionId) {
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
    
    // Check escrow is in disputed state
    if (transaction.escrow?.status !== 'disputed') {
      return res.status(400).json({ message: 'Escrow not in disputed state' });
    }
    
    transaction.escrow.status = 'resolved';
    transaction.escrow.resolution = resolution;
    transaction.escrow.resolvedAt = new Date();
    transaction.escrow.resolvedBy = req.user._id;
    
    if (resolution === 'release_to_buyer') {
      // Refund to buyer
      const refundAmount = transaction.paymentBreakdown?.totalPaid || 0;
      const buyer = await User.findById(transaction.buyer);
      if (buyer) {
        buyer.balance.available = (buyer.balance.available || 0) + refundAmount;
        buyer.notifications.unshift({
          type: 'sale',
          listing: transaction.listing,
          transaction: transaction._id,
          message: `Escrow dispute resolved. ${refundAmount} ${transaction.currency} refunded to your account.`,
        });
        await buyer.save();
      }
    } else if (resolution === 'release_to_seller') {
      // Release to seller
      const sellerEarnings = transaction.paymentBreakdown?.sellerEarnings || 0;
      const seller = await User.findById(transaction.seller);
      if (seller) {
        const reserveAmount = Math.round(sellerEarnings * 0.10 * 100) / 100;
        const availableAmount = sellerEarnings - reserveAmount;
        
        seller.balance.available = (seller.balance.available || 0) + availableAmount;
        seller.balance.totalEarned = (seller.balance.totalEarned || 0) + sellerEarnings;
        
        seller.notifications.unshift({
          type: 'sale',
          listing: transaction.listing,
          transaction: transaction._id,
          message: `Escrow dispute resolved. ${availableAmount} ${transaction.currency} added to your account.`,
        });
        await seller.save();
      }
    }
    
    await transaction.save();
    
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