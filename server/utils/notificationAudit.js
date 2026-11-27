/**
 * Read-only notification integrity helpers.
 *
 * Notifications are embedded in User documents, so deleting a transaction does
 * not remove the notifications that point at it. These helpers compare every
 * notification transaction reference with the transaction ids that still exist
 * and report dangling references. They never write to the database.
 */

const asTime = (value) => {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};

/**
 * @param {any[]} users user documents with a `notifications` array
 * @param {Iterable<any>} existingTransactionIds ids that still exist
 * @returns {Array<{userId: string, notificationId: string|null, type: string, transactionId: string, message: string, createdAt: any}>}
 */
function collectOrphanNotifications(users = [], existingTransactionIds = []) {
  const existing = new Set([...existingTransactionIds].map((id) => String(id)));
  const rows = [];

  for (const user of users) {
    for (const notification of user?.notifications || []) {
      if (!notification?.transaction) continue;
      const transactionId = String(notification.transaction);
      if (existing.has(transactionId)) continue;
      rows.push({
        userId: String(user._id),
        notificationId: notification._id ? String(notification._id) : null,
        type: String(notification.type || 'unknown'),
        transactionId,
        message: String(notification.message || ''),
        createdAt: notification.createdAt || null,
      });
    }
  }

  return rows.sort((a, b) => asTime(b.createdAt) - asTime(a.createdAt));
}

/**
 * Summarize rows from collectOrphanNotifications for an operator report.
 */
function summarizeOrphanNotifications(rows = []) {
  const byType = {};
  const affectedUsers = new Set();
  const missingTransactionIds = new Set();

  for (const row of rows) {
    byType[row.type] = (byType[row.type] || 0) + 1;
    affectedUsers.add(row.userId);
    missingTransactionIds.add(row.transactionId);
  }

  return {
    total: rows.length,
    byType,
    affectedUsers: affectedUsers.size,
    missingTransactionIds: [...missingTransactionIds].sort(),
    notifications: rows,
  };
}

/**
 * Execute the read-only audit. Models are injectable for database tests; in
 * production the real Mongoose models are used.
 */
async function auditOrphanNotifications({ UserModel, TransactionModel } = {}) {
  const User = UserModel || require('../models/User');
  const Transaction = TransactionModel || require('../models/Transaction');

  // Do not add `$ne: null`: with an array of subdocuments, a subdocument that
  // lacks `transaction` counts as a null match and would exclude the entire
  // user even though other notifications do reference transactions.
  const users = await User.find({
    'notifications.transaction': { $exists: true },
  })
    .select('_id notifications')
    .lean();

  const referencedIds = new Set();
  let notificationCount = 0;
  for (const user of users) {
    for (const notification of user.notifications || []) {
      notificationCount += 1;
      if (notification.transaction) referencedIds.add(String(notification.transaction));
    }
  }

  const existing = referencedIds.size > 0
    ? await Transaction.find({ _id: { $in: [...referencedIds] } }).select('_id').lean()
    : [];
  const existingIds = existing.map((transaction) => transaction._id);

  const rows = collectOrphanNotifications(users, existingIds);
  return {
    usersScanned: users.length,
    notificationsScanned: notificationCount,
    referencedTransactions: referencedIds.size,
    existingTransactions: existingIds.length,
    ...summarizeOrphanNotifications(rows),
  };
}

module.exports = {
  collectOrphanNotifications,
  summarizeOrphanNotifications,
  auditOrphanNotifications,
};
