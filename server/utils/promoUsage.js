/**
 * Release one reserved promo use. Failures are logged, never thrown: this is
 * compensating cleanup on a checkout that already failed for another reason.
 */
const Promo = require('../models/Promo');

const releasePromoUse = async (promoId) => {
  if (!promoId) return;
  try {
    await Promo.updateOne(
      { _id: promoId, usageCount: { $gt: 0 } },
      { $inc: { usageCount: -1 } },
    );
  } catch (e) {
    console.error('Promo rollback failed:', e.message);
  }
};

module.exports = { releasePromoUse };
