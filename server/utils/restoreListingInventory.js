const Listing = require('../models/Listing');
const User = require('../models/User');

// Restore inventory for a cancelled, refunded, or returned order.
//
// The old call sites only cleared `sold`/`available`; the listing kept
// `status: 'sold'`, so the public catalog (which requires status active) never
// showed it again and the seller had to edit the listing manually to relist.
// At the same time, blindly setting status active would resurrect listings of
// a suspended or deleted seller, so the seller's state is checked here.
async function restoreListingInventory(listingId, { quantity = 0, quantitySold = 0 } = {}) {
  const listing = await Listing.findById(listingId)
    .select('seller status suspensionPaused')
    .lean();
  if (!listing || listing.status === 'deleted') return null;

  const seller = await User.findById(listing.seller)
    .select('role deletedAt')
    .lean();
  const hidden = !seller
    || Boolean(seller.deletedAt)
    || seller.role === 'suspended'
    || listing.suspensionPaused === true;

  const inc = {};
  if (quantity) inc.quantity = quantity;
  if (quantitySold) inc.quantitySold = quantitySold;

  const set = {
    sold: false,
    available: !hidden,
  };
  if (hidden) {
    // Keep it unpublished and remember why, so an admin unsuspend can restore
    // exactly the listings the suspension hid.
    set.status = 'draft';
    set.suspensionPaused = true;
  } else if (listing.status === 'sold') {
    set.status = 'active';
  }

  return Listing.findOneAndUpdate(
    { _id: listingId, status: { $ne: 'deleted' } },
    {
      ...(Object.keys(inc).length ? { $inc: inc } : {}),
      $set: set,
    },
    { new: true },
  );
}

module.exports = restoreListingInventory;
