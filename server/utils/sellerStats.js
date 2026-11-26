const Transaction = require('../models/Transaction');
const Rating = require('../models/Rating');
const Return = require('../models/Return');
const User = require('../models/User');

// Statuses that represent money the seller actually earned. Pending/unpaid
// checkouts and every cancelled/refunded/chargeback state are excluded so a
// seller cannot inflate a tier by opening orders they never fulfil.
const SALE_STATUSES = [
  'paid',
  'processing',
  'shipped',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'completed',
  'buyer_confirmed',
  'dispute_resolved',
  'chargeback_won',
];

// A return counts against the seller once it has been accepted or completed.
// A denied/pending request is still a dispute, not a realized return.
const REALIZED_RETURN_STATUSES = [
  'approved',
  'shipped',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'received',
  'refunded',
  'completed',
  'disputed',
];

const TIER_THRESHOLDS = [
  { tier: 'platinum', minSales: 200, minRating: 4.8, maxReturnRate: 0.02 },
  { tier: 'gold', minSales: 50, minRating: 4.7, maxReturnRate: 0.05 },
  { tier: 'silver', minSales: 10, minRating: 4.5, maxReturnRate: 0.10 },
];

const clampRate = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

// Tier is a pure function of authoritative stats so the cron, the seller
// dashboard and admin review always agree on the same calculation.
const tierForStats = ({ salesCount, avgRating, returnRate }) => {
  for (const threshold of TIER_THRESHOLDS) {
    if (salesCount >= threshold.minSales
      && avgRating >= threshold.minRating
      && returnRate <= threshold.maxReturnRate) {
      return threshold.tier;
    }
  }
  return 'bronze';
};

// Derive every seller-badge metric from platform records. Callers must never
// accept these numbers from the client: a seller could otherwise grant
// themselves platinum placement, reduced fees and priority support.
const computeSellerStats = async (userId) => {
  const [salesCount, ratingAgg, realizedReturns, user] = await Promise.all([
    Transaction.countDocuments({ seller: userId, status: { $in: SALE_STATUSES } }),
    Rating.aggregate([
      { $match: { seller: userId } },
      { $group: { _id: null, avg: { $avg: '$rating' } } },
    ]),
    Return.countDocuments({ seller: userId, status: { $in: REALIZED_RETURN_STATUSES } }),
    User.findById(userId).select('stats.responseRate').lean(),
  ]);

  const avgRating = Math.round((ratingAgg[0]?.avg || 0) * 100) / 100;
  const returnRate = salesCount > 0 ? clampRate(realizedReturns / salesCount) : 0;
  // User.stats.responseRate is maintained by the messaging/offer flows as a
  // 0..100 percentage; badges store the normalized 0..1 contract.
  const rawResponseRate = user?.stats?.responseRate;
  const responseRate = rawResponseRate === undefined || rawResponseRate === null
    ? 1
    : clampRate(rawResponseRate > 1 ? rawResponseRate / 100 : rawResponseRate);

  return { salesCount, avgRating, responseRate, returnRate };
};

module.exports = {
  SALE_STATUSES,
  REALIZED_RETURN_STATUSES,
  TIER_THRESHOLDS,
  tierForStats,
  computeSellerStats,
};
