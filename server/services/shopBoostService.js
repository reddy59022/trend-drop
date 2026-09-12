// Shop Boost service (Feature 3).
//
// A seller-level "boost whole shop" toggle materializes the boost onto every
// active listing of the shop (basic/standard tier, highest feed priority).
//
// boost.individuallyBoosted is a TRUTHFUL flag set only by the individual
// listing-boost endpoints; the shop materialization never flips it. It
// drives listing.boost.source:
//   individuallyBoosted true  → source 'both'  (revert to individual on off)
//   individuallyBoosted false → source 'shop'  (revert to unboosted on off)
const ShopBoost = require('../models/ShopBoost');
const Listing = require('../models/Listing');
const { boostConfig } = require('../config/boost');

// Highest feed priority — above any individually-bought tier's effective
// range so shop-boosted items "guarantee" top placement on default feeds.
const SHOP_BOOST_PRIORITY_SCORE = 250;
const SHOP_BOOST_DURATION_DAYS = 30;

const hasActiveShopBoost = async (sellerId) =>
  Boolean(await ShopBoost.findOne({ seller: sellerId, active: true, endDate: { $gt: new Date() } }));

const getActiveShopBoost = async (sellerId) =>
  ShopBoost.findOne({ seller: sellerId, active: true, endDate: { $gt: new Date() } });

// Materialize the shop boost onto every active listing of the shop.
// Idempotent — safe to re-run on listing create/update/boost changes.
const applyShopBoostToSeller = async (sellerId, priorityScore = SHOP_BOOST_PRIORITY_SCORE) => {
  const now = new Date();
  return Listing.updateMany(
    { seller: sellerId, available: true, sold: false },
    [
      {
        $set: {
          'boost.active': true,
          'boost.shopBoostApplied': true,
          // Preserve a legacy individual boost detected on FIRST application.
          'boost.individuallyBoosted': {
            $ifNull: ['$boost.individuallyBoosted', { $eq: ['$boost.active', true] }],
          },
          'boost.source': {
            $cond: [{ $eq: ['$boost.individuallyBoosted', true] }, 'both', 'shop'],
          },
          // Keep the individually-bought tier when present; else standard.
          'boost.tier': { $cond: [{ $eq: ['$boost.individuallyBoosted', true] }, '$boost.tier', 'standard'] },
          'boost.startDate': { $ifNull: ['$boost.startDate', now] },
          'boost.endDate': {
            $ifNull: ['$boost.endDate', new Date(now.getTime() + SHOP_BOOST_DURATION_DAYS * 24 * 60 * 60 * 1000)],
          },
          'boost.durationDays': { $ifNull: ['$boost.durationDays', SHOP_BOOST_DURATION_DAYS] },
          // Remember the pre-shop values so 'both' listings can revert.
          'boost.originalTier': {
            $ifNull: ['$boost.originalTier', { $cond: [{ $eq: ['$boost.individuallyBoosted', true] }, '$boost.tier', ''] }],
          },
          'boost.originalPriorityScore': {
            $ifNull: [
              '$boost.originalPriorityScore',
              { $cond: [{ $eq: ['$boost.individuallyBoosted', true] }, { $ifNull: ['$boost.priorityScore', 0] }, 0] },
            ],
          },
          // Max priority: never downgrade a paid boost, always >= shop level.
          'boost.priorityScore': { $max: [{ $ifNull: ['$boost.priorityScore', 0] }, priorityScore] },
        },
      },
    ]
  );
};

// Revert shop boosts. 'both' listings return to their individual values;
// 'shop'-only listings return to unboosted.
const removeShopBoostFromSeller = async (sellerId) => {
  await Listing.updateMany(
    { seller: sellerId, 'boost.individuallyBoosted': true },
    [
      {
        $set: {
          'boost.active': true,
          'boost.source': 'listing',
          'boost.tier': { $ifNull: ['$boost.originalTier', { $cond: [{ $eq: ['$boost.tier', 'standard'] }, '', '$boost.tier'] }] },
          'boost.priorityScore': { $ifNull: ['$boost.originalPriorityScore', { $ifNull: ['$boost.priorityScore', 0] }] },
        },
      },
      {
        $unset: ['boost.shopBoostApplied', 'boost.originalTier', 'boost.originalPriorityScore'],
      },
    ]
  );
  await Listing.updateMany(
    { seller: sellerId, 'boost.individuallyBoosted': { $ne: true } },
    [
      {
        $set: {
          'boost.active': false,
          'boost.source': '',
          'boost.tier': '',
          'boost.priorityScore': 0,
        },
      },
      {
        $unset: ['boost.shopBoostApplied', 'boost.originalTier', 'boost.originalPriorityScore'],
      },
    ]
  );
};

// Called after listing create/update so a new listing joins an active shop boost.
const syncListingShopBoost = async (sellerId) => {
  const active = await getActiveShopBoost(sellerId);
  if (!active) return null;
  return applyShopBoostToSeller(sellerId);
};

// Auto-expire shop boosts whose endDate has passed and revert the listings.
const expireExpiredShopBoosts = async () => {
  const expired = await ShopBoost.find({ active: true, endDate: { $lte: new Date() } });
  for (const sb of expired) {
    await removeShopBoostFromSeller(sb.seller);
    sb.active = false;
    await sb.save();
  }
  return expired.length;
};

module.exports = {
  SHOP_BOOST_PRIORITY_SCORE,
  SHOP_BOOST_DURATION_DAYS,
  hasActiveShopBoost,
  getActiveShopBoost,
  applyShopBoostToSeller,
  removeShopBoostFromSeller,
  syncListingShopBoost,
  expireExpiredShopBoosts,
  boostShopConfig: {
    tier: 'standard',
    feePercent: boostConfig.tiers.standard.feePercent,
    durationDays: SHOP_BOOST_DURATION_DAYS,
  },
};