/**
 * Order/transaction consistency audit (pure logic).
 *
 * A consolidated Order must never disagree with the transactions underneath it:
 *  - all items refunded/cancelled/lost → order refunded;
 *  - all items completed → order completed;
 *  - a reversed item must not linger in the order or an open shipment.
 *
 * `classifyOrder` is used by scripts/reconcile-order-status.js (dry run by
 * default). Keeping it pure makes the decisions reviewable and testable without
 * a database.
 */

const REVERSED_TRANSACTION_STATUSES = new Set([
  'refunded',
  'cancelled_by_buyer',
  'cancelled_by_seller',
  'auto_cancelled',
  'chargeback_lost',
]);

const isReversedStatus = (status) => REVERSED_TRANSACTION_STATUSES.has(status);

const refundAmountFor = (transaction) => {
  const amount = transaction?.cancellation?.refundAmount
    ?? transaction?.paymentBreakdown?.totalPaid
    ?? transaction?.itemPrice
    ?? 0;
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric : 0;
};

/**
 * @param {any} order
 * @param {Map<string, any>} txnsById  transactions keyed by String(_id)
 */
function classifyOrder(order, txnsById) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemRows = items.map((item) => {
    const transactionId = String(item.transaction);
    const status = txnsById.get(transactionId)?.status || 'missing';
    return { transactionId, status };
  });

  const missingTransactions = itemRows
    .filter((row) => row.status === 'missing')
    .map((row) => row.transactionId);
  const reversedItems = itemRows.filter((row) => isReversedStatus(row.status));

  let expected = null;
  if (items.length === 0) {
    // A cancellation that removed every item should be terminal.
    if (order.cancellation?.cancelledAt && order.status !== 'refunded') expected = 'refunded';
  } else if (missingTransactions.length === 0 && itemRows.every((row) => isReversedStatus(row.status))) {
    expected = 'refunded';
  } else if (missingTransactions.length === 0 && itemRows.every((row) => row.status === 'completed')) {
    expected = 'completed';
  }

  const staleShipments = (order.shipments || [])
    .filter((shipment) => {
      const ids = (shipment.items || []).map((id) => String(id));
      if (ids.length === 0) return false;
      const allReversed = ids.every((id) => isReversedStatus(txnsById.get(id)?.status));
      return allReversed && shipment.status !== 'cancelled';
    })
    .map((shipment) => String(shipment._id));

  const statusMismatch = Boolean(expected && order.status !== expected);

  return {
    orderId: String(order._id),
    status: order.status,
    expected,
    statusMismatch,
    staleItems: reversedItems.map((row) => row.transactionId),
    staleShipments,
    missingTransactions,
    // A fully reversed order whose items are already gone still needs its status
    // fixed; stale items/shipments need the idempotent order sync.
    needsFix: Boolean(statusMismatch || reversedItems.length > 0 || staleShipments.length > 0),
  };
}

module.exports = {
  REVERSED_TRANSACTION_STATUSES,
  isReversedStatus,
  refundAmountFor,
  classifyOrder,
};
