const {
  isQaCommerceListing,
  holdsSellerCredit,
  sellerSaleCredit,
  planQaCommerce,
} = require('../utils/qaCommerceCleanup');

describe('QA commerce cleanup planner', () => {
  const seller = 'seller-1';
  const qaWebhook = { _id: 'l1', title: 'QA webhook flow 1795785937036' };
  const qaChargeback = { _id: 'l2', title: 'QA chargeback flow 1795787254973' };
  const real = { _id: 'l3', title: 'Sandbox API check 1795713067350' };

  const txn = (id, listing, status, extra = {}) => ({
    _id: id,
    listing,
    seller,
    status,
    paymentBreakdown: { sellerEarnings: 11.35 },
    ...extra,
  });

  test('matches only the webhook/chargeback QA titles', () => {
    expect(isQaCommerceListing(qaWebhook)).toBe(true);
    expect(isQaCommerceListing(qaChargeback)).toBe(true);
    expect(isQaCommerceListing(real)).toBe(false);
    expect(isQaCommerceListing({ title: 'QA webhook flow' })).toBe(false);
    expect(isQaCommerceListing(null)).toBe(false);
  });

  test('scopes transactions, returns and payouts to matched listings only', () => {
    const plan = planQaCommerce({
      listings: [qaWebhook, qaChargeback, real],
      transactions: [
        txn('t1', 'l1', 'refunded'),
        txn('t2', 'l2', 'chargeback_won'),
        txn('t3', 'l3', 'completed'),
      ],
      returns: [{ _id: 'r1', transaction: 't1' }, { _id: 'r2', transaction: 't3' }],
      payouts: [{ _id: 'p1', transaction: 't2' }, { _id: 'p2', transaction: 't3' }],
      orders: [],
    });

    expect(plan.qaListings.map((l) => l._id)).toEqual(['l1', 'l2']);
    expect(plan.qaTransactions.map((t) => t._id)).toEqual(['t1', 't2']);
    expect(plan.qaReturns.map((r) => r._id)).toEqual(['r1']);
    expect(plan.qaPayouts.map((p) => p._id)).toEqual(['p1']);
  });

  test('deletes an order only when every item is a QA transaction', () => {
    const plan = planQaCommerce({
      listings: [qaWebhook],
      transactions: [txn('t1', 'l1', 'refunded'), txn('t2', 'l1', 'refunded')],
      orders: [
        { _id: 'o1', items: [{ transaction: 't1' }, { transaction: 't2' }] },
        { _id: 'o2', items: [{ transaction: 't1' }, { transaction: 't9' }] },
      ],
    });

    expect(plan.qaOrders.map((o) => o._id)).toEqual(['o1']);
    expect(plan.blockedOrders.map((o) => o._id)).toEqual(['o2']);
  });

  test('reports the credit only for sales that were never reversed', () => {
    const won = txn('t2', 'l2', 'chargeback_won');
    const refunded = txn('t1', 'l1', 'refunded');
    const refundedPayout = txn('t4', 'l1', 'return_in_transit', { payout: { status: 'refunded' } });
    const lost = txn('t5', 'l2', 'chargeback_lost');

    expect(sellerSaleCredit(won)).toBe(11.35);
    expect(holdsSellerCredit(won)).toBe(true);
    expect(holdsSellerCredit(refunded)).toBe(false);
    expect(holdsSellerCredit(refundedPayout)).toBe(false);
    expect(holdsSellerCredit(lost)).toBe(false);

    const plan = planQaCommerce({
      listings: [qaWebhook, qaChargeback],
      transactions: [won, refunded, refundedPayout, lost],
    });
    expect(plan.creditReversals).toEqual([
      { transactionId: 't2', sellerId: seller, amount: 11.35 },
    ]);
  });
});
