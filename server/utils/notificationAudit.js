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

module.exports = {
  collectOrphanNotifications,
  summarizeOrphanNotifications,
};
