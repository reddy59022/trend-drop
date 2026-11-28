/**
 * Daily outbound tracking reconciliation.
 *
 * The webhook is best-effort; this job must keep every active order accurate
 * using the carrier tracker only, never a timer, and must never regress or
 * double-apply a state.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');

jest.mock('../services/easypostService', () => {
  const actual = jest.requireActual('../services/easypostService');
  return { ...actual, isMockMode: () => false, getTracker: jest.fn() };
});

const { getTracker } = require('../services/easypostService');
const { syncOutboundTracking } = require('../services/outboundTrackingSync');

const created = [];
let testIds = [];
let seller;
let buyer;

const mkTxn = async ({ status = 'shipped', trackerId, trackingNumber } = {}) => {
  const listing = await Listing.create({
    seller: seller._id, title: `Tracking sync ${Date.now()}-${Math.random()}`,
    description: 'test', price: 20, category: 'Women', condition: 'Good',
    quantity: 0, quantitySold: 1, available: false, sold: true, status: 'active',
    shipsFrom: 'US', currency: 'USD',
  });
  created.push(listing._id);
  testIds.push(listing._id);
  const txn = await Transaction.create({
    listing: listing._id, buyer: buyer._id, seller: seller._id,
    itemPrice: 20, currency: 'USD', quantity: 1, status,
    shipping: {
      provider: 'easypost',
      trackerId: trackerId === undefined ? `trk_${Date.now()}_${Math.random()}` : trackerId,
      trackingNumber: trackingNumber === undefined ? `1Z${Date.now()}${Math.floor(Math.random() * 1000)}` : trackingNumber,
      labelCreatedDate: new Date('2026-11-18T12:00:00Z'),
    },
    paymentBreakdown: {
      subtotal: 20, originalSubtotal: 20, discountAmount: 0, shippingCost: 5,
      buyerProtectionFee: 1, totalPaid: 26, platformFee: 1.6, platformFeePercent: 8,
      sellerEarnings: 18.4, paymentIntentId: `pi_track_${Date.now()}_${Math.random()}`,
    },
    payout: { status: 'pending' },
  });
  created.push(txn._id);
  testIds.push(txn._id);
  return txn;
};

const tracker = (status, details = []) => ({ status, tracking_details: details });

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  seller = await User.create({
    name: 'Tracking Sync Seller', email: `tracking-sync-seller-${Date.now()}@test.com`,
    password: 'password123', emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
  });
  buyer = await User.create({
    name: 'Tracking Sync Buyer', email: `tracking-sync-buyer-${Date.now()}@test.com`,
    password: 'password123', emailVerified: true, authProvider: 'email',
    country: 'US', currency: 'USD',
  });
});

beforeEach(() => {
  getTracker.mockReset();
  testIds = [];
});

// Only this test's shipments may be eligible during a run; otherwise an earlier
// case's still-active transaction is reconciled again and skews the counters.
afterEach(async () => {
  if (!testIds.length) return;
  await Transaction.deleteMany({ _id: { $in: testIds } });
  await Listing.deleteMany({ _id: { $in: testIds } });
  testIds = [];
});

afterAll(async () => {
  await Transaction.deleteMany({ _id: { $in: created } });
  await Listing.deleteMany({ _id: { $in: created } });
  await User.deleteMany({ _id: { $in: [seller._id, buyer._id] } });
  await mongoose.connection.close();
});

describe('outbound tracking reconciliation', () => {
  test('OTS.1 advances shipped → in_transit with the carrier scan time and location', async () => {
    const txn = await mkTxn({ status: 'shipped' });
    getTracker.mockResolvedValue(tracker('in_transit', [
      { status: 'in_transit', message: 'Departed facility', datetime: '2026-11-20T10:30:00Z', tracking_location: { city: 'Los Angeles', state: 'CA' } },
    ]));

    const summary = await syncOutboundTracking({ now: new Date('2026-11-22T01:15:00Z') });
    const fresh = await Transaction.findById(txn._id);

    expect(summary).toMatchObject({ scanned: 1, updated: 1, failed: 0 });
    expect(fresh.status).toBe('in_transit');
    const last = fresh.shipping.trackingHistory[fresh.shipping.trackingHistory.length - 1];
    expect(last.status).toBe('in_transit');
    expect(last.location).toBe('Los Angeles, CA');
    expect(new Date(last.timestamp).toISOString()).toBe('2026-11-20T10:30:00.000Z');
    expect(fresh.autoTracking.attempts).toBe(1);
    expect(fresh.autoTracking.lastChecked).toBeInstanceOf(Date);
  });

  test('OTS.2 marks delivered from the delivery scan (actualDelivery, not poll time)', async () => {
    const txn = await mkTxn({ status: 'out_for_delivery' });
    getTracker.mockResolvedValue(tracker('delivered', [
      { status: 'out_for_delivery', message: 'Out for delivery', datetime: '2026-11-21T08:00:00Z' },
      { status: 'delivered', message: 'Delivered, front door', datetime: '2026-11-21T15:42:00Z', tracking_location: { city: 'Austin', state: 'TX' } },
    ]));

    const summary = await syncOutboundTracking({ now: new Date('2026-11-22T01:15:00Z') });
    const fresh = await Transaction.findById(txn._id);

    expect(summary.updated).toBe(1);
    expect(fresh.status).toBe('delivered');
    expect(new Date(fresh.shipping.actualDelivery).toISOString()).toBe('2026-11-21T15:42:00.000Z');
    expect(fresh.shipping.trackingHistory.at(-1).status).toBe('delivered');
  });

  test('OTS.3 never regresses out_for_delivery when the tracker lags', async () => {
    const txn = await mkTxn({ status: 'out_for_delivery' });
    getTracker.mockResolvedValue(tracker('in_transit', [
      { status: 'in_transit', message: 'In transit', datetime: '2026-11-21T09:00:00Z' },
    ]));

    const summary = await syncOutboundTracking();
    const fresh = await Transaction.findById(txn._id);

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
    expect(fresh.status).toBe('out_for_delivery');
  });

  test('OTS.4 one failing tracker does not stop the batch', async () => {
    const failing = await mkTxn({ status: 'shipped', trackerId: `trk_fail_${Date.now()}` });
    const healthy = await mkTxn({ status: 'shipped', trackerId: `trk_ok_${Date.now()}` });
    getTracker.mockImplementation(async (id) => {
      if (id === failing.shipping.trackerId) {
        const error = new Error('EasyPost request failed');
        error.code = 'SHIPPING_PROVIDER_UNAVAILABLE';
        throw error;
      }
      return tracker('out_for_delivery', [
        { status: 'out_for_delivery', message: 'On vehicle', datetime: '2026-11-21T07:00:00Z' },
      ]);
    });

    const summary = await syncOutboundTracking();
    const freshFailing = await Transaction.findById(failing._id);
    const freshHealthy = await Transaction.findById(healthy._id);

    expect(summary.failed).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.errors[0].transactionId).toBe(String(failing._id));
    expect(freshFailing.status).toBe('shipped');
    expect(freshHealthy.status).toBe('out_for_delivery');
  });

  test('OTS.5 ignores paid, delivered, cancelled and tracker-less orders', async () => {
    const paid = await mkTxn({ status: 'paid' });
    const delivered = await mkTxn({ status: 'delivered' });
    const cancelled = await mkTxn({ status: 'cancelled' });
    const noTracker = await mkTxn({ status: 'shipped', trackerId: '' });
    getTracker.mockResolvedValue(tracker('delivered', [
      { status: 'delivered', message: 'Delivered', datetime: '2026-11-21T12:00:00Z' },
    ]));

    const summary = await syncOutboundTracking();
    const [freshPaid, freshDelivered, freshCancelled, freshNoTracker] = await Promise.all([
      Transaction.findById(paid._id), Transaction.findById(delivered._id),
      Transaction.findById(cancelled._id), Transaction.findById(noTracker._id),
    ]);

    expect(summary.scanned).toBe(0);
    expect(getTracker).not.toHaveBeenCalled();
    expect(freshPaid.status).toBe('paid');
    expect(freshDelivered.status).toBe('delivered');
    expect(freshCancelled.status).toBe('cancelled');
    expect(freshNoTracker.status).toBe('shipped');
  });

  test('OTS.6 is idempotent across overlapping runs', async () => {
    const txn = await mkTxn({ status: 'shipped' });
    getTracker.mockResolvedValue(tracker('in_transit', [
      { status: 'in_transit', message: 'Accepted at USPS', datetime: '2026-11-20T09:00:00Z' },
    ]));

    const first = await syncOutboundTracking();
    const second = await syncOutboundTracking();
    const fresh = await Transaction.findById(txn._id);

    expect(first.updated).toBe(1);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(fresh.status).toBe('in_transit');
    expect(fresh.shipping.trackingHistory.filter((event) => event.status === 'in_transit')).toHaveLength(1);
    expect(fresh.autoTracking.attempts).toBe(2);
  });
});
