const { classifyOrder, refundAmountFor } = require('../utils/orderStatusReconcile');

const txn = (id, status, extra = {}) => ({ _id: id, status, ...extra });
const mapOf = (...txns) => new Map(txns.map((t) => [String(t._id), t]));

describe('classifyOrder', () => {
  const item = (transactionId) => ({ transaction: transactionId, listing: `listing-${transactionId}` });
  const shipment = (id, items, status = 'confirmed') => ({ _id: id, items, status });

  test('flags an order left active after every item was refunded', () => {
    const plan = classifyOrder(
      {
        _id: 'o1',
        status: 'confirmed',
        items: [item('t1'), item('t2')],
        shipments: [shipment('s1', ['t1', 't2'])],
      },
      mapOf(txn('t1', 'refunded'), txn('t2', 'cancelled_by_buyer')),
    );

    expect(plan.expected).toBe('refunded');
    expect(plan.statusMismatch).toBe(true);
    expect(plan.staleItems).toEqual(['t1', 't2']);
    expect(plan.staleShipments).toEqual(['s1']);
    expect(plan.needsFix).toBe(true);
  });

  test('flags an order never completed after every item completed', () => {
    const plan = classifyOrder(
      {
        _id: 'o2',
        status: 'shipped',
        items: [item('t1')],
        shipments: [shipment('s1', ['t1'])],
      },
      mapOf(txn('t1', 'completed')),
    );

    expect(plan.expected).toBe('completed');
    expect(plan.statusMismatch).toBe(true);
    expect(plan.needsFix).toBe(true);
  });

  test('a partial refund only flags the reversed item, not the whole order', () => {
    const plan = classifyOrder(
      {
        _id: 'o3',
        status: 'partially_shipped',
        items: [item('t1'), item('t2')],
        shipments: [shipment('s1', ['t1']), shipment('s2', ['t2'], 'shipped')],
      },
      mapOf(txn('t1', 'refunded'), txn('t2', 'shipped')),
    );

    expect(plan.expected).toBeNull();
    expect(plan.statusMismatch).toBe(false);
    expect(plan.staleItems).toEqual(['t1']);
    expect(plan.staleShipments).toEqual(['s1']);
    expect(plan.needsFix).toBe(true);
  });

  test('a won chargeback is a standing sale and needs no order change', () => {
    const plan = classifyOrder(
      {
        _id: 'o4',
        status: 'confirmed',
        items: [item('t1')],
        shipments: [shipment('s1', ['t1'])],
      },
      mapOf(txn('t1', 'chargeback_won')),
    );

    expect(plan.expected).toBeNull();
    expect(plan.needsFix).toBe(false);
  });

  test('a lost chargeback reverses the order', () => {
    const plan = classifyOrder(
      {
        _id: 'o5',
        status: 'shipped',
        items: [item('t1')],
        shipments: [shipment('s1', ['t1'])],
      },
      mapOf(txn('t1', 'chargeback_lost')),
    );

    expect(plan.expected).toBe('refunded');
    expect(plan.needsFix).toBe(true);
  });

  test('an order whose refunded items were removed already only needs its status fixed', () => {
    const plan = classifyOrder(
      {
        _id: 'o6',
        status: 'confirmed',
        items: [],
        shipments: [],
        cancellation: { cancelledAt: new Date('2026-01-01T00:00:00Z') },
      },
      mapOf(),
    );

    expect(plan.expected).toBe('refunded');
    expect(plan.statusMismatch).toBe(true);
    expect(plan.needsFix).toBe(true);
  });

  test('missing transactions are reported, never guessed', () => {
    const plan = classifyOrder(
      {
        _id: 'o7',
        status: 'confirmed',
        items: [item('t1'), item('missing')],
        shipments: [],
      },
      mapOf(txn('t1', 'refunded')),
    );

    expect(plan.expected).toBeNull();
    expect(plan.missingTransactions).toEqual(['missing']);
    expect(plan.staleItems).toEqual(['t1']);
  });

  test('refundAmountFor prefers the recorded cancellation amount', () => {
    expect(refundAmountFor({ cancellation: { refundAmount: 17.2 }, paymentBreakdown: { totalPaid: 99 }, itemPrice: 5 })).toBe(17.2);
    expect(refundAmountFor({ paymentBreakdown: { totalPaid: 99 }, itemPrice: 5 })).toBe(99);
    expect(refundAmountFor({ itemPrice: 5 })).toBe(5);
    expect(refundAmountFor(null)).toBe(0);
  });
});
