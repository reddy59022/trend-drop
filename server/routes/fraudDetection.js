const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');

// In-memory store for velocity tracking (in production, use Redis)
const velocityTracker = new Map();

// ===================== FRAUD DETECTION CHECK =====================
// POST /api/fraud/check - Check transaction for fraud risk
router.post('/check', auth, async (req, res) => {
  try {
    const { listingId, amount, ipAddress, userAgent } = req.body;
    
    if (!listingId || !amount) {
      return res.status(400).json({ message: 'listingId and amount are required' });
    }
    
    const risks = [];
    let riskScore = 0;
    
    // Get user info
    const user = await User.findById(req.user._id);
    const listing = await Listing.findById(listingId);
    
    if (!listing) {
      risks.push({ type: 'invalid_listing', severity: 'high' });
      riskScore += 50;
    }
    
    // Check 1: Velocity - Too many transactions in short time
    const userId = req.user._id.toString();
    const recentTransactions = velocityTracker.get(userId) || [];
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentCount = recentTransactions.filter(t => t > oneHourAgo).length;
    
    if (recentCount > 5) {
      risks.push({ type: 'high_velocity', severity: 'medium', count: recentCount });
      riskScore += 20;
    }
    
    // Check 2: Multiple accounts from same IP (tracked in production)
    // In production, query database for other users with same IP
    
    // Check 3: Suspicious amount patterns
    if (amount > 500) {
      risks.push({ type: 'high_value', severity: 'low', amount });
      riskScore += 15;
    }
    
    // Check 4: New account + high value
    const accountAge = Date.now() - new Date(user.createdAt).getTime();
    const accountAgeDays = Math.floor(accountAge / (1000 * 60 * 60 * 24));
    
    if (accountAgeDays < 7 && amount > 100) {
      risks.push({ type: 'new_account_high_value', severity: 'medium', days: accountAgeDays });
      riskScore += 25;
    }
    
    // Check 5: Unusual location (if IP tracking enabled)
    if (ipAddress) {
      // In production: call IP geolocation API
      // For now, flag if IP is from high-risk country
      const highRiskCountries = ['KP', 'IR', 'SY', 'CU']; // Example high-risk countries
      // Mock check - in production use real IP geolocation
      risks.push({ type: 'ip_check', severity: 'info', ipAddress });
    }
    
    // Determine risk level
    let riskLevel = 'low';
    if (riskScore >= 50) riskLevel = 'high';
    else if (riskScore >= 25) riskLevel = 'medium';
    
    // Record this transaction for velocity tracking
    velocityTracker.set(userId, [...recentTransactions, Date.now()]);
    
    res.json({
      riskScore,
      riskLevel,
      risks,
      recommendations: {
        manualReview: riskScore >= 25,
        additionalVerification: riskScore >= 50,
        decline: riskScore >= 75,
      },
    });
  } catch (error) {
    console.error('Fraud check error:', error);
    res.status(500).json({ message: 'Fraud check failed' });
  }
});

// ===================== GET RISK SETTINGS =====================
// GET /api/fraud/settings - Get platform risk settings
router.get('/settings', (req, res) => {
  res.json({
    highValueThreshold: 500, // USD
    velocityThreshold: 5, // transactions per hour
    newAccountThresholdDays: 7,
    newAccountHighValueThreshold: 100,
    highRiskCountries: ['KP', 'IR', 'SY', 'CU'],
    manualReviewThreshold: 25,
    declineThreshold: 75,
  });
});

// ===================== FLAG TRANSACTION =====================
// POST /api/fraud/flag - Flag a transaction for manual review
router.post('/flag', auth, async (req, res) => {
  try {
    const { transactionId, reason, notes } = req.body;
    
    if (!transactionId) {
      return res.status(400).json({ message: 'transactionId is required' });
    }
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    // Only allow flagging own transactions or admin flagging any
    if (String(transaction.buyer) !== String(req.user._id)) {
      // Check if admin
      const user = await User.findById(req.user._id);
      if (user.role !== 'admin') {
        return res.status(403).json({ message: 'Not authorized to flag this transaction' });
      }
    }
    
    transaction.fraudFlag = {
      flagged: true,
      reason: reason || 'manual_review',
      notes,
      flaggedAt: new Date(),
      flaggedBy: req.user._id,
    };
    await transaction.save();
    
    res.json({ flagged: true, transaction });
  } catch (error) {
    console.error('Fraud flag error:', error);
    res.status(500).json({ message: 'Failed to flag transaction' });
  }
});

module.exports = router;