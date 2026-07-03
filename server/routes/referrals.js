const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Referral = require('../models/Referral');
const User = require('../models/User');

// ===================== REFERRAL PROGRAM =====================
// Track referrals with unique codes and reward both parties

// GET /api/referrals/settings - Get referral program settings (public)
router.get('/settings', (req, res) => {
  res.json({
    enabled: true,
    rewardAmount: 10, // USD
    currency: 'USD',
    maxUsesPerCode: null, // Unlimited
    expiresInDays: 30, // Referral codes expire after 30 days
  });
});

// POST /api/referrals/generate - Generate a new referral code
router.post('/generate', auth, async (req, res) => {
  try {
    // Check if user already has an active referral code
    const existing = await Referral.findOne({ referrer: req.user._id, status: 'active' });

    if (existing) {
      return res.json({ referral: existing });
    }

    const code = await Referral.generateCode(req.user._id);

    const referral = await Referral.create({
      referrer: req.user._id,
      code,
      uses: 0,
      maxUses: null,
      rewardAmount: 10,
      currency: 'USD',
      status: 'active',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });

    res.status(201).json({ referral });
  } catch (error) {
    console.error('Generate referral error:', error);
    res.status(500).json({ message: 'Failed to generate referral code' });
  }
});

// POST /api/referrals/apply - Apply a referral code during registration
router.post('/apply', async (req, res) => {
  try {
    const { code, userId } = req.body;

    if (!code) {
      return res.status(400).json({ message: 'Referral code is required' });
    }

    const referral = await Referral.findOne({ code: code.toUpperCase() });

    if (!referral) {
      return res.status(404).json({ message: 'Invalid referral code' });
    }

    // Check if referral is active and not expired
    if (referral.status !== 'active') {
      return res.status(400).json({ message: 'Referral code is not active' });
    }

    if (referral.expiresAt && referral.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Referral code has expired' });
    }

    // Check max uses
    if (referral.maxUses && referral.uses >= referral.maxUses) {
      return res.status(400).json({ message: 'Referral code has reached maximum uses' });
    }

    // If userId provided, link the referral
    if (userId) {
      // Check if user already used a referral
      const alreadyUsed = await Referral.findOne({ referred: userId });
      if (alreadyUsed) {
        return res.status(400).json({ message: 'User already used a referral code' });
      }

      referral.referredUsers.push({
        user: userId,
        createdAt: new Date(),
        rewardGiven: false,
      });
      referral.uses += 1;
      await referral.save();
    }

    res.json({
      valid: true,
      rewardAmount: referral.rewardAmount,
      currency: referral.currency,
    });
  } catch (error) {
    console.error('Apply referral error:', error);
    res.status(500).json({ message: 'Failed to apply referral code' });
  }
});

// GET /api/referrals/my - Get user's referral stats (authenticated)
router.get('/my', auth, async (req, res) => {
  try {
    const referral = await Referral.findOne({ referrer: req.user._id });

    const stats = {
      code: referral?.code || null,
      uses: referral?.uses || 0,
      rewardClaimed: referral?.rewardClaimed || false,
      referredUsers: referral?.referredUsers?.length || 0,
      rewardAmount: referral?.rewardAmount || 10,
      status: referral?.status || 'none',
    };

    res.json({ stats });
  } catch (error) {
    console.error('Get referral stats error:', error);
    res.status(500).json({ message: 'Failed to get referral stats' });
  }
});

// POST /api/referrals/claim - Claim referral reward
router.post('/claim', auth, async (req, res) => {
  try {
    const referral = await Referral.findOne({ referrer: req.user._id, status: 'active' });

    if (!referral) {
      return res.status(404).json({ message: 'No active referral found' });
    }

    const user = await User.findById(req.user._id);

    // Add reward to user's balance
    user.balance.available = (user.balance.available || 0) + referral.rewardAmount;
    user.balance.totalEarned = (user.balance.totalEarned || 0) + referral.rewardAmount;
    referral.rewardClaimed = true;

    await user.save();
    await referral.save();

    // Mark all referred users as having received reward
    for (const referredUser of referral.referredUsers) {
      if (!referredUser.rewardGiven) {
        referredUser.rewardGiven = true;
      }
    }
    await referral.save();

    res.json({
      message: `Reward of ${referral.rewardAmount} ${referral.currency} claimed successfully`,
      newBalance: user.balance.available,
    });
  } catch (error) {
    console.error('Claim referral error:', error);
    res.status(500).json({ message: 'Failed to claim referral reward' });
  }
});

// GET /api/referrals/:code - Validate a referral code (public)
router.get('/:code', async (req, res) => {
  try {
    const referral = await Referral.findOne({ code: req.params.code.toUpperCase() });

    if (!referral) {
      return res.status(404).json({ valid: false, message: 'Invalid referral code' });
    }

    if (referral.status !== 'active') {
      return res.status(400).json({ valid: false, message: 'Referral code not active' });
    }

    res.json({
      valid: true,
      rewardAmount: referral.rewardAmount,
      currency: referral.currency,
    });
  } catch (error) {
    console.error('Validate referral error:', error);
    res.status(500).json({ message: 'Failed to validate referral code' });
  }
});

module.exports = router;