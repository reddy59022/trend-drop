// Sale notification factory for ATOMIC purchase updates.
// ============================================================
// Purchase paths credit sellers / notify buyers with raw atomic updates
// ($push / aggregation pipelines) instead of load-modify-save, so concurrent
// purchases of the same seller's items can never race on document versioning.
// The trade-off: mongoose does not apply subdoc defaults on raw updates, so
// the fields normally defaulted on save must be supplied explicitly —
//   _id       → notification dismissal (notifications.id(id)) + React keys
//   read      → unread tracking
//   createdAt → notification ordering
const mongoose = require('mongoose');

function saleNotification({ from, listing, transaction, message }) {
  return {
    _id: new mongoose.Types.ObjectId(),
    type: 'sale',
    from,
    listing,
    transaction,
    message,
    read: false,
    createdAt: new Date(),
  };
}

module.exports = { saleNotification };
