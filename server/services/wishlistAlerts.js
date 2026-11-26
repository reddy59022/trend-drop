// Wishlist alert fan-out.
//
// Uses only the existing Mongo/Mongoose stack: no queue, no paid service, and
// no new dependency. Recipients are read through the indexed
// `items.listing` path and written in bounded bulkWrite batches so a popular
// item with hundreds of thousands of watchers does not build one giant op.

const Wishlist = require('../models/Wishlist');
const User = require('../models/User');

const WRITE_BATCH_SIZE = 500;

async function getWishlistUserIds(listingId, excludeUserId) {
  const rows = await Wishlist.find({ 'items.listing': listingId })
    .select('user')
    .lean();
  const exclude = excludeUserId ? String(excludeUserId) : null;
  return rows
    .map((row) => String(row.user))
    .filter((id) => id !== exclude);
}

async function pushNotifications(userIds, notification) {
  let notified = 0;
  for (let i = 0; i < userIds.length; i += WRITE_BATCH_SIZE) {
    const batch = userIds.slice(i, i + WRITE_BATCH_SIZE);
    const operations = batch.map((userId) => ({
      updateOne: {
        filter: { _id: userId },
        update: {
          $push: {
            notifications: {
              $each: [{ ...notification, read: false, createdAt: new Date() }],
              $position: 0,
            },
          },
        },
      },
    }));
    if (operations.length > 0) {
      await User.bulkWrite(operations);
      notified += operations.length;
    }
  }
  return notified;
}

/**
 * Notify everyone who wishlisted `sourceListingId`.
 * `linkListingId` lets a relist point at the new listing while recipients are
 * still resolved from the old (sold) one.
 */
async function notifyWishlisters(sourceListingId, {
  type,
  message,
  excludeUserId,
  linkListingId = sourceListingId,
}) {
  const userIds = await getWishlistUserIds(sourceListingId, excludeUserId);
  if (userIds.length === 0) return 0;
  return pushNotifications(userIds, {
    type,
    ...(excludeUserId ? { from: excludeUserId } : {}),
    listing: linkListingId,
    message,
  });
}

module.exports = {
  getWishlistUserIds,
  notifyWishlisters,
};
