const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const LoyaltyProgram = require('../models/LoyaltyProgram');
const Listing = require('../models/Listing');
const { isValidObjectId } = require('../utils/validators');

// GET /api/loyalty - Get user loyalty status
router.get('/', auth, async (req, res) => {
  try {
    let loyalty = await LoyaltyProgram.findOne({ user: req.user._id });
    
    if (!loyalty) {
      loyalty = await LoyaltyProgram.create({ user: req.user._id, points: 0, tier: 'Silver' });
    }

    res.json(loyalty);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch loyalty status' });
  }
});

// POST /api/loyalty/earn - Earn points
// Server-authoritative: clients may only declare a whitelisted reason; the
// point amount is derived server-side so a crafted request cannot pick its own
// number. `purchase` still scales with a client-DECLARED spend, though, so the
// derivation alone does not bound a répétition: the rolling ceiling below is
// what makes the balance un-mintable (see MAX_POINTS_PER_DAY).
const EARN_RULES = {
  purchase: { pointsPerDollar: 1, maxPerEvent: 10000 },
  referral: { fixed: 100, maxPerEvent: 100 },
  anniversary: { fixed: 500, maxPerEvent: 500 },
  review: { fixed: 10, maxPerEvent: 10 },
  signup: { fixed: 50, maxPerEvent: 50 },
};

// Every earn reason is UNBACKED: `purchase` trusts a client-declared amount and
// the fixed reasons can simply be called again. Per-event caps therefore left
// the balance mintable forever — 10 calls x the 10,000-point purchase event =
// 100,000 points = $1,000 of discount at POST /redeem's $0.01/point. Cap the
// total granted per user over a rolling 24h window, measured from the persisted
// pointsHistory itself (entries already carry createdAt).
// NOTE: this is a rate limit, not a ledger invariant — concurrent bursts can
// overshoot slightly. The spend side stays exact: /redeem only debits a balance
// that is covered, atomically.
const MAX_POINTS_PER_DAY = 10000;
const POINTS_WINDOW_MS = 24 * 60 * 60 * 1000;

const tierForPoints = (points) => {
  if (points >= 10000) return 'Platinum';
  if (points >= 5000) return 'Gold';
  return 'Silver';
};
router.post('/earn', auth, async (req, res) => {
  try {
    const { amount, reason, listingId, purchaseAmount } = req.body;

    const rule = EARN_RULES[reason];
    if (!rule) {
      return res.status(400).json({ message: 'Invalid or missing earn reason' });
    }

    // Optional listing reference must be a real listing — a garbage id would
    // CastError the $push (500) and a ghost id would leave an orphan entry.
    if (listingId !== undefined && listingId !== null && listingId !== '') {
      if (!isValidObjectId(listingId)) {
        return res.status(400).json({ message: 'Invalid listingId' });
      }
      const listingExists = await Listing.findById(listingId);
      if (!listingExists) {
        return res.status(404).json({ message: 'Listing not found' });
      }
    }

    let points = 0;
    if (rule.pointsPerDollar) {
      const spend = Number(purchaseAmount ?? amount);
      if (!Number.isFinite(spend) || spend <= 0 || spend > 1000000) {
        return res.status(400).json({ message: 'Invalid purchase amount' });
      }
      points = Math.min(Math.floor(spend * rule.pointsPerDollar), rule.maxPerEvent);
    } else {
      points = rule.fixed;
    }
    if (!Number.isFinite(points) || points <= 0 || points > rule.maxPerEvent) {
      return res.status(400).json({ message: 'Invalid points amount' });
    }

    // ============================================================
    // ROLLING CEILING (TDD R28). The per-event cap above only bounds ONE call;
    // nothing stopped the same call being repeated. `purchase` trusts a
    // client-declared spend, and the fixed reasons can simply be replayed, so
    // the balance was mintable without limit (10 x the 10,000-point event =
    // 100,000 points = $1,000 at /redeem's $0.01/point) — and the tier system
    // with it. Sum what was actually GRANTED (positive ledger entries) over the
    // last 24h and refuse anything that would cross the ceiling, before any
    // write. Redemptions (negative entries) never count toward it.
    // ============================================================
    const existing = await LoyaltyProgram.findOne({ user: req.user._id })
      .select('pointsHistory');
    if (existing) {
      const windowStart = Date.now() - POINTS_WINDOW_MS;
      const grantedRecently = (existing.pointsHistory || []).reduce((sum, entry) => {
        if (!entry || !(entry.amount > 0)) return sum;
        const at = entry.createdAt ? new Date(entry.createdAt).getTime() : 0;
        return at >= windowStart ? sum + entry.amount : sum;
      }, 0);
      if (grantedRecently + points > MAX_POINTS_PER_DAY) {
        return res.status(429).json({
          message: `Daily points limit reached (max ${MAX_POINTS_PER_DAY} points per 24 hours)`,
        });
      }
    }

    // The read-only ceiling check above is useful for a fast rejection, but it
    // is not sufficient under concurrent requests. Ensure a document exists,
    // then enforce the same rolling ceiling in the atomic update predicate.
    try {
      await LoyaltyProgram.findOneAndUpdate(
        { user: req.user._id },
        { $setOnInsert: { user: req.user._id, points: 0, tier: 'Silver' } },
        { new: true, upsert: true }
      );
    } catch (initializationError) {
      // Another request may have won the unique-user upsert. Continue against
      // that ledger rather than creating a second document or minting points.
      if (initializationError?.code !== 11000) throw initializationError;
    }
    const atomicWindowStart = new Date(Date.now() - POINTS_WINDOW_MS);
    const grantedInWindow = {
      $sum: {
        $map: {
          input: {
            $filter: {
              input: { $ifNull: ['$pointsHistory', []] },
              as: 'entry',
              cond: {
                $and: [
                  { $gt: ['$$entry.amount', 0] },
                  { $gte: ['$$entry.createdAt', atomicWindowStart] },
                ],
              },
            },
          },
          as: 'entry',
          in: '$$entry.amount',
        },
      },
    };
    const loyalty = await LoyaltyProgram.findOneAndUpdate(
      {
        user: req.user._id,
        $expr: {
          $lte: [{ $add: [grantedInWindow, points] }, MAX_POINTS_PER_DAY],
        },
      },
      {
        $inc: { points },
        $push: { pointsHistory: { amount: points, reason, listing: listingId } },
      },
      { new: true }
    );
    if (!loyalty) {
      return res.status(429).json({
        message: `Daily points limit reached (max ${MAX_POINTS_PER_DAY} points per 24 hours)`,
      });
    }

    // Update tier based on points
    loyalty.tier = tierForPoints(loyalty.points);
    
    await loyalty.save();

    res.json(loyalty);
  } catch (error) {
    res.status(500).json({ message: 'Failed to earn points' });
  }
});

// POST /api/loyalty/redeem - Redeem points for discount
router.post('/redeem', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || !Number.isInteger(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Invalid redeem amount' });
    }

    // Atomic: decrement only when the balance covers it, so two concurrent
    // redeems can never spend the same points twice.
    const loyalty = await LoyaltyProgram.findOneAndUpdate(
      { user: req.user._id, points: { $gte: numericAmount } },
      {
        $inc: { points: -numericAmount },
        $push: { pointsHistory: { amount: -numericAmount, reason: 'redemption' } },
      },
      { new: true }
    );
    if (!loyalty) {
      return res.status(400).json({ message: 'Insufficient points' });
    }

    // Redemptions can move a member below a tier threshold; persist and return
    // the recalculated tier so the client never displays stale entitlements.
    loyalty.tier = tierForPoints(loyalty.points);
    await loyalty.save();

    res.json({ discount: numericAmount * 0.01, points: loyalty.points, tier: loyalty.tier });
  } catch (error) {
    res.status(500).json({ message: 'Failed to redeem points' });
  }
});

// GET /api/loyalty/history - Get points history
router.get('/history', auth, async (req, res) => {
  try {
    const loyalty = await LoyaltyProgram.findOne({ user: req.user._id });
    res.json(loyalty?.pointsHistory || []);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch history' });
  }
});

module.exports = router;