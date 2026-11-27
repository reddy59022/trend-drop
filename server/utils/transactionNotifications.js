// Notification cleanup for transaction deletion paths.
//
// Notifications live inside User documents and reference transactions by
// ObjectId. Deleting a transaction without removing those notifications leaves
// dangling references that the scheduled orphan audit can only detect after the
// fact. Every production transaction deletion must remove its notifications
// first so a failed notification cleanup aborts the deletion instead of
// creating a new orphan.
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const normalizeTransactionIds = (transactionIds) => {
  const values = Array.isArray(transactionIds) ? transactionIds : [transactionIds];
  const seen = new Set();
  const ids = [];
  for (const value of values) {
    const id = value?._id || value;
    if (!id) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
};

/**
 * Remove every notification (all types) that references one of the supplied
 * transactions. Returns the number of user documents modified.
 */
const removeNotificationsForTransactions = async (transactionIds) => {
  const ids = normalizeTransactionIds(transactionIds);
  if (ids.length === 0) return 0;

  const result = await User.updateMany(
    { 'notifications.transaction': { $in: ids } },
    { $pull: { notifications: { transaction: { $in: ids } } } },
  );
  return result.modifiedCount || 0;
};

/**
 * Delete transactions only after their dependent notifications are gone. If
 * notification cleanup throws, the transactions are left intact and the caller
 * can surface/retry the failure without creating orphans.
 */
const deleteTransactionsWithNotifications = async (transactionIds) => {
  const ids = normalizeTransactionIds(transactionIds);
  if (ids.length === 0) return { notificationsModified: 0, deleted: 0 };

  const notificationsModified = await removeNotificationsForTransactions(ids);
  const result = await Transaction.deleteMany({ _id: { $in: ids } });
  return {
    notificationsModified,
    deleted: result.deletedCount || 0,
  };
};

module.exports = {
  removeNotificationsForTransactions,
  deleteTransactionsWithNotifications,
};
