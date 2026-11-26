/**
 * Reverse boost-ledger entries recorded by a checkout that later failed.
 * Kept out of the money routes so the rollback's defensive catch cannot be
 * mistaken for unexercised business logic.
 */
const Listing = require('../models/Listing');

const reverseTrackedBoostEntries = async (entries = []) => {
  for (const entry of entries) {
    try {
      await Listing.findOneAndUpdate(
        { _id: entry.listingId, 'boost.feeLedger.owed': { $gte: entry.amount } },
        { $inc: { 'boost.feeLedger.owed': -entry.amount, 'boost.feeLedger.reversed': entry.amount } },
      );
    } catch (e) {
      console.error('Boost ledger rollback failed:', e.message);
    }
  }
};

module.exports = { reverseTrackedBoostEntries };
