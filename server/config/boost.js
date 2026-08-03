// Product Boost Configuration
// Sellers pay 10% of listing price to boost visibility

const boostConfig = {
  // Boost fee is 10% of the listing price
  boostFeePercent: 10,
  // Minimum boost duration
  minDurationDays: 7,
  // Maximum boost duration
  maxDurationDays: 30,
  // Default boost duration
  defaultDurationDays: 14,
  // Priority boost multiplier (boosted items appear first)
  priorityMultiplier: 10,
  // Maximum active boosts per seller (prevents spam)
  maxActiveBoosts: 10,
  // Boost tiers (optional premium tiers)
  tiers: {
    standard: {
      name: 'Standard Boost',
      feePercent: 10,
      priorityScore: 1,
      features: ['Priority placement', 'Featured badge', 'Search boost'],
    },
    premium: {
      name: 'Premium Boost',
      feePercent: 15,
      priorityScore: 2,
      features: ['Top placement', 'Featured badge', 'Search boost', 'Homepage spotlight', 'Category highlight'],
    },
    elite: {
      name: 'Elite Boost',
      feePercent: 20,
      priorityScore: 3,
      features: ['#1 placement', 'Featured badge', 'Search boost', 'Homepage spotlight', 'Category highlight', 'Push notification to followers', 'Social media promotion'],
    },
  },
};

// Calculate boost fee for a listing
// fee = flat per-sale deduction (price × tier.feePercent / 100)
// totalUpfrontCost = daily rate × duration (what seller pays upfront)
const calculateBoostFee = (listingPrice, tier = 'standard', durationDays = 14) => {
  const boostTier = boostConfig.tiers[tier] || boostConfig.tiers.standard;
  const fee = Math.round(listingPrice * (boostTier.feePercent / 100) * 100) / 100;
  const dailyRate = Math.round(fee / boostConfig.defaultDurationDays * 100) / 100;
  const totalUpfrontCost = Math.round(dailyRate * durationDays * 100) / 100;
  return {
    fee,
    dailyRate,
    totalUpfrontCost,
    tier: boostTier.name,
    durationDays,
    features: boostTier.features,
    boostFeePercent: boostTier.feePercent,
    priorityScore: boostTier.priorityScore,
  };
};

// Calculate priority score for a listing (for sorting)
const calculatePriorityScore = (listing) => {
  let score = 0;

  // Base: recency (newer = higher)
  const ageInHours = (Date.now() - new Date(listing.createdAt)) / (1000 * 60 * 60);
  score += Math.max(0, 100 - ageInHours * 0.1); // Decreases over time

  // Likes boost
  score += (listing.likes?.length || 0) * 2;

  // Boost factor
  if (listing.boost && listing.boost.active) {
    const boostTier = boostConfig.tiers[listing.boost.tier] || boostConfig.tiers.standard;
    const daysRemaining = Math.max(0, (new Date(listing.boost.endDate) - Date.now()) / (1000 * 60 * 60 * 24));
    score += boostTier.priorityScore * 50 * (daysRemaining / (listing.boost.durationDays || 14));
  }

  // Views boost
  score += Math.min((listing.views || 0) * 0.5, 50);

  return Math.round(score * 100) / 100;
};

module.exports = { boostConfig, calculateBoostFee, calculatePriorityScore };