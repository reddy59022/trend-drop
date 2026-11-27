/**
 * QA commerce cleanup planning (pure logic).
 *
 * The webhook/chargeback QA runs left listings, orders, transactions, returns and
 * payouts behind. Deletion is destructive, so selection is deliberately tight:
 *  - only listings whose title can only come from those runs are matched;
 *  - an order is deletable only when EVERY item belongs to the matched set — a
 *    consolidated order that also contains a real item is reported, never
 *    partially deleted;
 *  - returns/payouts are scoped by the matched transactions;
 *  - only dispute/sale notifications tied to the matched transactions are
 *    selected, because deleting those transactions would orphan them.
 *
 * The planner also reports which matched transactions still hold a seller credit
 * (a sale that was never refunded/reversed). Deleting those records without
 * reversing the credit would leave the seller paid for an order that no longer
 * exists, so the operator script reverses it first.
 */

const QA_TITLE_PATTERN = /^QA (?:webhook|chargeback) flow /i;

/** Statuses whose sale credit was already returned to the buyer/seller ledger. */
const REVERSED_STATUSES = new Set([
  'refunded',
  'cancelled_by_buyer',
  'cancelled_by_seller',
  'auto_cancelled',
  'chargeback_lost',
]);

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const isQaCommerceListing = (listing) =>
  typeof listing?.title === 'string' && QA_TITLE_PATTERN.test(listing.title);

/** Sale credit still held for this transaction (0 when it was reversed). */
const sellerSaleCredit = (transaction) => {
  const breakdown = transaction?.paymentBreakdown || {};
  const credit = breakdown.sellerCredit !== undefined && breakdown.sellerCredit !== null
    ? breakdown.sellerCredit
    : breakdown.sellerEarnings;
  const amount = Number(credit || 0);
  return Number.isFinite(amount) ? round2(amount) : 0;
};

const holdsSellerCredit = (transaction) => {
  if (!transaction) return false;
  if (REVERSED_STATUSES.has(String(transaction.status))) return false;
  if (transaction.payout?.status === 'refunded') return false;
  return sellerSaleCredit(transaction) > 0;
};

const NOTIFICATION_TYPES = new Set(['dispute', 'sale']);

/**
 * @param {{listings?: any[], transactions?: any[], orders?: any[], returns?: any[], payouts?: any[], users?: any[]}} data
 */
function planQaCommerce({
  listings = [],
  transactions = [],
  orders = [],
  returns = [],
  payouts = [],
  users = [],
} = {}) {
  const qaListings = listings.filter(isQaCommerceListing);
  const listingIds = new Set(qaListings.map((l) => String(l._id)));

  const qaTransactions = transactions.filter((t) => listingIds.has(String(t.listing)));
  const transactionIds = new Set(qaTransactions.map((t) => String(t._id)));

  const qaOrders = [];
  const blockedOrders = [];
  for (const order of orders) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (items.length === 0) continue;
    const matched = items.filter((item) =>
      transactionIds.has(String(item.transaction)) || listingIds.has(String(item.listing)));
    if (matched.length === 0) continue;
    // Every item must be a matched QA row, or the order is left for a human.
    if (items.every((item) => transactionIds.has(String(item.transaction)))) qaOrders.push(order);
    else blockedOrders.push(order);
  }

  const qaReturns = returns.filter((r) => transactionIds.has(String(r.transaction)));
  const qaPayouts = payouts.filter((p) => transactionIds.has(String(p.transaction)));

  // Deleting a QA transaction would leave its "Item sold" and chargeback
  // notifications pointing at a record that no longer exists. Select exactly
  // those two notification types for the transactions about to be deleted;
  // real-transaction and unrelated notification types are never included.
  const notificationRemovals = [];
  for (const user of users) {
    const notifications = (user.notifications || []).filter((notification) =>
      NOTIFICATION_TYPES.has(String(notification?.type))
      && notification?.transaction
      && transactionIds.has(String(notification.transaction)));
    if (notifications.length === 0) continue;
    const dispute = notifications.filter((n) => n.type === 'dispute').length;
    const sale = notifications.filter((n) => n.type === 'sale').length;
    notificationRemovals.push({
      userId: String(user._id),
      notificationIds: notifications.map((n) => n._id).filter(Boolean),
      dispute,
      sale,
      total: notifications.length,
    });
  }
  const notificationCounts = notificationRemovals.reduce((acc, row) => ({
    dispute: acc.dispute + row.dispute,
    sale: acc.sale + row.sale,
    total: acc.total + row.total,
  }), { dispute: 0, sale: 0, total: 0 });

  const creditReversals = qaTransactions
    .filter(holdsSellerCredit)
    .map((t) => ({
      transactionId: String(t._id),
      sellerId: String(t.seller),
      amount: sellerSaleCredit(t),
    }))
    .filter((row) => row.sellerId && row.amount > 0);

  return {
    qaListings,
    qaTransactions,
    qaOrders,
    qaReturns,
    qaPayouts,
    notificationRemovals,
    notificationCounts,
    blockedOrders,
    creditReversals,
  };
}

module.exports = {
  QA_TITLE_PATTERN,
  REVERSED_STATUSES,
  isQaCommerceListing,
  holdsSellerCredit,
  sellerSaleCredit,
  planQaCommerce,
};
