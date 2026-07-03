const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const ShippingInsurance = require('../models/ShippingInsurance');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

// ===================== SELLER SHIPPING INSURANCE =====================
// Optional insurance for sellers to protect against shipping loss/damage

// GET /api/shipping-insurance/settings - Get insurance settings (public)
router.get('/settings', (req, res) => {
  res.json({
    enabled: true,
    coverageTypes: {
      basic: { limit: 100, rate: 0.03, description: 'Up to $100 coverage' },
      standard: { limit: 500, rate: 0.02, description: 'Up to $500 coverage' },
      premium: { limit: 2000, rate: 0.015, description: 'Up to $2000 coverage' },
    },
    minPremium: 2,
    expirationDays: 7,
  });
});

// POST /api/shipping-insurance/calculate - Calculate premium
router.post('/calculate', async (req, res) => {
  try {
    const { itemValue, coverageType = 'standard' } = req.body;

    if (!itemValue || itemValue <= 0) {
      return res.status(400).json({ message: 'Valid item value is required' });
    }

    const premium = ShippingInsurance.calculatePremium(itemValue, coverageType);
    const limit = ShippingInsurance.getCoverageLimit(coverageType);

    res.json({
      itemValue,
      coverageType,
      premium,
      limit,
      currency: 'USD',
    });
  } catch (error) {
    console.error('Calculate insurance error:', error);
    res.status(500).json({ message: 'Failed to calculate insurance' });
  }
});

// POST /api/shipping-insurance/purchase - Purchase insurance for a transaction
router.post('/purchase', auth, async (req, res) => {
  try {
    const { transactionId, coverageType = 'standard' } = req.body;

    if (!transactionId) {
      return res.status(400).json({ message: 'Transaction ID is required' });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Only seller can purchase insurance
    if (String(transaction.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only seller can purchase insurance' });
    }

    // Check if insurance already exists
    const existing = await ShippingInsurance.findOne({ transaction: transactionId });
    if (existing) {
      return res.status(400).json({ message: 'Insurance already purchased for this transaction' });
    }

    const itemValue = transaction.paymentBreakdown?.subtotal || transaction.itemPrice || 0;
    const premium = ShippingInsurance.calculatePremium(itemValue, coverageType);
    const limit = ShippingInsurance.getCoverageLimit(coverageType);

    const insurance = await ShippingInsurance.create({
      transaction: transactionId,
      seller: req.user._id,
      itemValue,
      premium,
      currency: transaction.currency || 'USD',
      coverageType,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    res.status(201).json({ insurance });
  } catch (error) {
    console.error('Purchase insurance error:', error);
    res.status(500).json({ message: 'Failed to purchase insurance' });
  }
});

// GET /api/shipping-insurance/my - Get seller's insurance policies
router.get('/my', auth, async (req, res) => {
  try {
    const policies = await ShippingInsurance.find({ seller: req.user._id })
      .populate('transaction', 'status itemPrice')
      .sort({ createdAt: -1 });

    res.json({ policies });
  } catch (error) {
    console.error('Get insurance policies error:', error);
    res.status(500).json({ message: 'Failed to fetch insurance policies' });
  }
});

// POST /api/shipping-insurance/:id/claim - File a claim
router.post('/:id/claim', auth, async (req, res) => {
  try {
    const { reason, description, evidence } = req.body;
    const insuranceId = req.params.id;

    const insurance = await ShippingInsurance.findById(insuranceId);
    if (!insurance) {
      return res.status(404).json({ message: 'Insurance not found' });
    }

    // Only seller can file claim
    if (String(insurance.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only seller can file claim' });
    }

    // Check insurance is active and not expired
    if (insurance.status !== 'active') {
      return res.status(400).json({ message: 'Insurance is not active' });
    }

    if (insurance.expiresAt < new Date()) {
      insurance.status = 'expired';
      await insurance.save();
      return res.status(400).json({ message: 'Insurance has expired' });
    }

    // Check if claim already filed
    if (insurance.claim?.status) {
      return res.status(400).json({ message: 'Claim already filed' });
    }

    insurance.claim = {
      filedAt: new Date(),
      reason,
      description,
      evidence: evidence || [],
      status: 'pending',
    };
    insurance.status = 'claimed';

    await insurance.save();

    // Notify admin
    const user = await User.findById(req.user._id);
    if (user) {
      user.notifications.unshift({
        type: 'sale',
        message: `Insurance claim filed for transaction ${insurance.transaction}. Reason: ${reason}`,
      });
      await user.save();
    }

    res.json({ insurance });
  } catch (error) {
    console.error('File claim error:', error);
    res.status(500).json({ message: 'Failed to file claim' });
  }
});

// POST /api/shipping-insurance/:id/refund - Process insurance refund
router.post('/:id/refund', auth, async (req, res) => {
  try {
    const insurance = await ShippingInsurance.findById(req.params.id);
    if (!insurance) {
      return res.status(404).json({ message: 'Insurance not found' });
    }

    // Only seller can request refund
    if (String(insurance.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only seller can request refund' });
    }

    // Check insurance is active and shipping lost
    if (insurance.status !== 'claimed' || insurance.claim?.status !== 'approved') {
      return res.status(400).json({ message: 'Insurance claim not approved for refund' });
    }

    // Add refund to seller's balance
    const seller = await User.findById(req.user._id);
    if (seller) {
      const payoutAmount = insurance.claim.payoutAmount || Math.min(insurance.itemValue, ShippingInsurance.getCoverageLimit(insurance.coverageType));
      seller.balance.available = (seller.balance.available || 0) + payoutAmount;
      seller.balance.totalEarned = (seller.balance.totalEarned || 0) + payoutAmount;
      
      insurance.claim.paidAt = new Date();
      insurance.claim.payoutCurrency = insurance.currency;
      insurance.refunded = true;
      insurance.status = 'claimed'; // Keep status as claimed after payout
      
      await seller.save();
    }

    await insurance.save();

    res.json({
      message: 'Insurance refund processed',
      insurance,
    });
  } catch (error) {
    console.error('Insurance refund error:', error);
    res.status(500).json({ message: 'Failed to process insurance refund' });
  }
});

module.exports = router;