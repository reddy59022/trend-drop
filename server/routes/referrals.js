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
    // Expire stale codes before looking for a reusable one, otherwise an
    // expired active record is returned forever and no fresh code is issued.
    await Referral.updateMany(
      { referrer: req.user._id, status: 'active', expiresAt: { $ne: null, $lt: new Date() } },
      { $set: { status: 'expired' } },
    );

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

// POST /api/referrals/apply - Apply a referral code to the signed-in account.
// Authentication is required: the old public route accepted any userId, so an
// attacker could attach arbitrary victims to their code and claim a cash
// reward for people who never used it.
router.post('/apply', auth, async (req, res) => {
  try {
    const { code, userId } = req.body;

    if (userId !== undefined && userId !== null && String(userId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only apply a referral code to your own account' });
    }

    // `code` must be a string: a number/object would reach `.toUpperCase()`
    // and throw a TypeError -> 500. Reject non-strings outright.
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ message: 'Referral code is required' });
    }

    const referral = await Referral.findOne({ code: code.trim().toUpperCase() });

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

    const linkedUserId = req.user._id;

    // Self-referral is fraud: a user must never consume their own code.
    if (String(referral.referrer) === String(linkedUserId)) {
      return res.status(400).json({ message: 'You cannot use your own referral code' });
    }

    // An account may be attributed to only one referrer. Without this a user
    // could apply code A and then code B, and both referrers could claim a
    // reward for the same signup.
    const alreadyLinked = await Referral.exists({
      $or: [{ 'referredUsers.user': linkedUserId }, { referred: linkedUserId }],
    });
    if (alreadyLinked) {
      return res.status(400).json({ message: 'User already used a referral code' });
    }

    // Claim the attribution on the user document atomically. The Referral
    // update below is a separate document, so this is what actually serializes
    // two simultaneous requests using different codes: exactly one can set
    // referralApplied false -> true.
    const referralUser = await User.findOneAndUpdate(
      { _id: linkedUserId, referralApplied: { $ne: true } },
      { $set: { referralApplied: true, referredBy: referral.referrer } },
      { new: true }
    );
    if (!referralUser) {
      return res.status(400).json({ message: 'User already used a referral code' });
    }

    // Atomically reserve this referral for the authenticated user. The old
    // read/check/save sequence allowed two concurrent requests to both
    // succeed, increment uses twice, and append duplicate referred-user
    // entries.
    const usageFilter = {
      _id: referral._id,
      status: 'active',
      'referredUsers.user': { $ne: linkedUserId },
    };
    if (referral.expiresAt) usageFilter.expiresAt = { $gt: new Date() };
    if (referral.maxUses !== null && referral.maxUses !== undefined) {
      usageFilter.uses = { $lt: referral.maxUses };
    }

    const appliedReferral = await Referral.findOneAndUpdate(
      usageFilter,
      {
        $set: { referred: linkedUserId },
        $inc: { uses: 1 },
        $push: {
          referredUsers: {
            user: linkedUserId,
            createdAt: new Date(),
            rewardGiven: false,
          },
        },
      },
      { new: true }
    );
    if (!appliedReferral) {
      // The code expired or hit its use cap after the user attribution was
      // reserved; release it so the user can still apply a valid code.
      await User.updateOne(
        { _id: linkedUserId, referralApplied: true, referredBy: referral.referrer },
        { $set: { referralApplied: false, referredBy: null } },
      );
      return res.status(400).json({ message: 'User already used a referral code' });
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
    // A code expiring must not forfeit rewards already earned with it. Look
    // for the active code first, then fall back to a code that has referred
    // users even if its share link has expired.
    let existing = await Referral.findOne({ referrer: req.user._id, status: 'active' });
    if (!existing) {
      existing = await Referral.findOne({
        referrer: req.user._id,
        $or: [{ 'referredUsers.0': { $exists: true } }, { referred: { $ne: null } }],
      }).sort({ createdAt: -1 });
    }
    if (!existing) {
      return res.status(404).json({ message: 'No active referral found' });
    }
    if (existing.rewardClaimed) {
      return res.status(400).json({ message: 'Referral reward already claimed' });
    }

    // A freshly generated code has zero successful referrals. Paying then
    // would let every user mint the referral bonus without referring anyone.
    const candidateUserIds = existing.referredUsers?.length
      ? existing.referredUsers.map((entry) => entry.user)
      : (existing.referred ? [existing.referred] : []);
    // Never pay for a deleted or suspended account. Otherwise a referrer can
    // create an account, apply their own code, delete the account, and still
    // collect a cash reward for the empty shell.
    const eligibleUsers = candidateUserIds.length
      ? await User.find({
          _id: { $in: candidateUserIds },
          deletedAt: null,
          role: { $ne: 'suspended' },
          emailVerified: true,
        }).select('_id').lean()
      : [];
    if (eligibleUsers.length === 0) {
      return res.status(400).json({ message: 'No completed referrals to claim' });
    }

    // Atomic single-claim: flip rewardClaimed false->true ONLY if still
    // false. Check-then-save raced under concurrency (both 200, double
    // credit); this serializes claims in the DB so exactly one wins.
    const referral = await Referral.findOneAndUpdate(
      { _id: existing._id, rewardClaimed: { $ne: true } },
      { $set: { rewardClaimed: true } },
      { new: true }
    );

    if (!referral) {
      return res.status(400).json({ message: 'Referral reward already claimed' });
    }

    // Credit once for every eligible referred user. The UI and referral policy
    // expose rewardAmount per successful referral, so paying only one amount
    // would silently shortchange referrers with multiple conversions.
    const eligibleIds = new Set(eligibleUsers.map((user) => String(user._id)));
    const rewardTotal = referral.rewardAmount * eligibleUsers.length;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { 'balance.available': rewardTotal, 'balance.totalEarned': rewardTotal } },
      { new: true }
    );

    // Mark all referred users as having received reward
    if (referral.referredUsers && referral.referredUsers.length > 0) {
      for (const referredUser of referral.referredUsers) {
        if (!referredUser.rewardGiven && eligibleIds.has(String(referredUser.user))) {
          referredUser.rewardGiven = true;
        }
      }
      await referral.save();
    }

    res.json({
      message: `Reward of ${rewardTotal} ${referral.currency} claimed successfully`,
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

    // Expiry must be honored here too (parity with POST /apply): without
    // this an expired code still validated as usable.
    if (referral.expiresAt && referral.expiresAt < new Date()) {
      return res.status(400).json({ valid: false, message: 'Referral code has expired' });
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