/**
 * Purchase-label safety net.
 *
 * Contract:
 *   1. Buyer is only AUTHORIZED (manual capture) before postage is bought.
 *   2. A label is bought before capture; a label failure creates NO order, NO
 *      transaction, and the authorization is released (buyer not charged).
 *   3. A provider response without shipment id/tracking is unusable: refund it
 *      and fail closed.
 *   4. If an immediate refund fails, the postage is queued durably and recovered
 *      by the retry cron — never silently absorbed by the platform.
 *   5. Cancelling before shipment voids the label immediately and refunds the
 *      buyer; a provider failure leaves a pending flag the cron settles.
 */
jest.mock('../services/easypostService', () => {
  const actual = jest.requireActual('../services/easypostService');
  return {
    ...actual,
    createShippingLabel: jest.fn(),
    refundShippingLabel: jest.fn(),
  };
});

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Order = require('../models/Order');
const Payout = require('../models/Payout');
const LabelRefund = require('../models/LabelRefund');
const authorizedPaymentIntent = require('./helpers/authorizedPayment');
const { createShippingLabel, refundShippingLabel } = require('../services/easypostService');
const { retryPendingLabelRefunds } = require('../config/cron');

const PASS = 'password123';
const SHIPPING = {
  fullName: 'Safety Buyer', street1: '456 Oak Ave', city: 'Dallas',
  state: 'TX', postalCode: '75201', country: 'US', phone: '+15555550123',
};

let seller;
let buyer;
let buyerToken;
let labelSeq = 0;
const created = [];

const labelFor = (overrides = {}) => {
  labelSeq += 1;
  return {
    trackingNumber: `EZSAFE${labelSeq}`,
    carrier: 'USPS',
    carrierCode: 'USPS',
    service: 'Ground Advantage',
    trackingUrl: 'https://easypost.test/track',
    labelUrl: 'https://easypost.test/label.pdf',
    labelPdfUrl: 'https://easypost.test/label.pdf',
    cost: 5,
    provider: 'easypost',
    shipmentId: `shp_safety_${labelSeq}`,
    rateId: `rate_safety_${labelSeq}`,
    trackerId: `trk_safety_${labelSeq}`,
    estimatedDelivery: new Date(Date.now() + 5 * 86400000),
    status: 'label_created',
    statusHistory: [],
    ...overrides,
  };
};

const createUser = async (name, email, withAddress = true) => {
  const user = await User.create({
    name, email: email.toLowerCase(), password: PASS,
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    ...(withAddress ? {
      shippingAddress: {
        fullName: name, street1: '633 W 5th St', city: 'Los Angeles',
        state: 'CA', postalCode: '90071', country: 'US', phone: '+15555550111',
      },
    } : {}),
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, totalListings: 0, avgRating: 0, ratingCount: 0, responseRate: 100, shipTime: 3, strikes: 0 },
  });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '30d' });
  return { user, token };
};

const mkListing = async (overrides = {}) => {
  const listing = await Listing.create({
    seller: seller._id, title: `Label safety ${Date.now()}-${Math.random()}`,
    description: 'label safety', price: 50, category: 'Men',
    condition: 'New with tags', available: true, sold: false, quantity: 1,
    shipsFrom: 'US', weight: 1,
    shipping: { domestic: true, international: false },
    ...overrides,
  });
  created.push(listing._id);
  return listing;
};

// The repo's mock Stripe authorizes a requires_capture intent directly; the
// live create-intent route is covered by its own suites. Money safety here is
// about what confirm-batch does with that authorization.
const createIntent = async (_listings) => authorizedPaymentIntent('requires_capture');

const confirmBatch = (paymentIntentId, listings) => request(app)
  .post('/api/payments/confirm-batch')
  .set('Authorization', `Bearer ${buyerToken}`)
  .send({
    paymentIntentId,
    items: listings.map((l) => ({ listingId: String(l._id), quantity: 1 })),
    shippingAddress: SHIPPING,
  });

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  ({ user: seller } = await createUser('Safety Seller', `safety-seller-${Date.now()}@test.com`));
  ({ user: buyer, token: buyerToken } = await createUser('Safety Buyer', `safety-buyer-${Date.now()}@test.com`));
});

beforeEach(() => {
  createShippingLabel.mockReset();
  refundShippingLabel.mockReset().mockResolvedValue({ refunded: true, status: 'submitted' });
});

// Each case owns its money state; a previous case's order/transaction must not
// make a later "nothing was created" assertion pass or fail by accident.
afterEach(async () => {
  await Transaction.deleteMany({ buyer: buyer._id });
  await Order.deleteMany({ buyer: buyer._id });
  await Payout.deleteMany({ seller: seller._id });
});

afterAll(async () => {
  await Transaction.deleteMany({ buyer: buyer._id });
  await Order.deleteMany({ buyer: buyer._id });
  await Payout.deleteMany({ seller: seller._id });
  await Listing.deleteMany({ _id: { $in: created } });
  await LabelRefund.deleteMany({ shipmentId: /^shp_safety_/ });
  await User.deleteMany({ _id: { $in: [seller._id, buyer._id] } });
  await mongoose.connection.close();
});

describe('label purchase safety', () => {
  test('LPS.1 second label failure creates no order/transaction and releases the authorization', async () => {
    const [a, b] = await Promise.all([mkListing(), mkListing()]);
    const first = labelFor();
    createShippingLabel
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(Object.assign(new Error('EasyPost rejected label'), { code: 'SHIPPING_LABEL_FAILED', status: 422 }));
    const pi = await createIntent([a, b]);

    const res = await confirmBatch(pi, [a, b]);

    expect(res.status).toBe(502);
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
    expect(await Transaction.countDocuments({ buyer: buyer._id })).toBe(0);
    const [freshA, freshB] = await Promise.all([Listing.findById(a._id), Listing.findById(b._id)]);
    expect(freshA.quantity).toBe(1);
    expect(freshA.available).toBe(true);
    expect(freshB.quantity).toBe(1);
    expect(refundShippingLabel).toHaveBeenCalledWith(first.shipmentId);
    expect(global.__mockPaymentIntents[pi].status).not.toBe('succeeded');
  });

  test('LPS.2 an incomplete provider response is unusable: refunded, no order, 502', async () => {
    const listing = await mkListing();
    createShippingLabel.mockResolvedValueOnce(labelFor({ trackingNumber: '', shipmentId: 'shp_safety_incomplete' }));
    const pi = await createIntent([listing]);

    const res = await confirmBatch(pi, [listing]);

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SHIPPING_LABEL_INCOMPLETE');
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
    expect(await Transaction.countDocuments({ buyer: buyer._id })).toBe(0);
    expect(refundShippingLabel).toHaveBeenCalledWith('shp_safety_incomplete');
  });

  test('LPS.3 a failed immediate refund is queued durably and recovered by cron', async () => {
    const listing = await mkListing();
    createShippingLabel.mockResolvedValueOnce(labelFor({ trackingNumber: '', shipmentId: 'shp_safety_queue' }));
    refundShippingLabel.mockRejectedValue(new Error('EasyPost unavailable'));
    const pi = await createIntent([listing]);

    const res = await confirmBatch(pi, [listing]);
    expect(res.status).toBe(502);

    const queued = await LabelRefund.findOne({ shipmentId: 'shp_safety_queue' });
    expect(queued).toBeTruthy();
    expect(queued.status).toBe('pending');
    expect(queued.attempts).toBe(0);

    refundShippingLabel.mockResolvedValue({ refunded: true, status: 'submitted' });
    const recovered = await retryPendingLabelRefunds();
    expect(recovered).toBeGreaterThanOrEqual(1);
    const settled = await LabelRefund.findOne({ shipmentId: 'shp_safety_queue' });
    expect(settled.status).toBe('refunded');
    expect(settled.refundedAt).toBeInstanceOf(Date);
  });

  test('LPS.4 cancel before shipment voids the label, refunds the buyer, and is idempotent', async () => {
    const listing = await mkListing();
    const label = labelFor();
    createShippingLabel.mockResolvedValue(label);
    const pi = await createIntent([listing]);
    const confirmed = await confirmBatch(pi, [listing]);
    expect(confirmed.status).toBe(201);
    if (confirmed.status !== 201) throw new Error(JSON.stringify(confirmed.body));
    const txnId = confirmed.body.transactions[0]._id;
    expect(refundShippingLabel).not.toHaveBeenCalled();

    const cancel = await request(app)
      .post(`/api/orders/${txnId}/cancel`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'changed mind' });
    expect(cancel.status).toBe(200);
    if (cancel.status !== 200) throw new Error(JSON.stringify(cancel.body));
    expect(refundShippingLabel).toHaveBeenCalledWith(label.shipmentId);

    const closed = await Transaction.findById(txnId).lean();
    expect(closed.status).toBe('cancelled_by_buyer');
    expect(closed.shipping.voided).toBe(true);
    expect(closed.shipping.labelRefunded).toBe(true);
    expect(closed.shipping.labelRefundPending).toBe(false);

    const refundCalls = refundShippingLabel.mock.calls.length;
    const again = await request(app)
      .post(`/api/orders/${txnId}/cancel`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'double click' });
    expect(again.status).toBe(200);
    expect(again.body.alreadyCancelled).toBe(true);
    expect(refundShippingLabel.mock.calls.length).toBe(refundCalls);
  });

  test('LPS.5 cancel refund provider failure leaves a pending flag the cron settles', async () => {
    const listing = await mkListing();
    const label = labelFor();
    createShippingLabel.mockResolvedValue(label);
    const pi = await createIntent([listing]);
    const confirmed = await confirmBatch(pi, [listing]);
    expect(confirmed.status).toBe(201);
    const txnId = confirmed.body.transactions[0]._id;

    refundShippingLabel.mockRejectedValue(new Error('EasyPost 503'));
    const cancel = await request(app)
      .post(`/api/orders/${txnId}/cancel`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'changed mind' });
    expect(cancel.status).toBe(200);

    const pending = await Transaction.findById(txnId).lean();
    expect(pending.status).toBe('cancelled_by_buyer');
    expect(pending.shipping.labelRefundPending).toBe(true);
    expect(pending.shipping.labelRefunded).not.toBe(true);

    refundShippingLabel.mockResolvedValue({ refunded: true, status: 'submitted' });
    await retryPendingLabelRefunds();

    const settled = await Transaction.findById(txnId).lean();
    expect(settled.shipping.labelRefunded).toBe(true);
    expect(settled.shipping.labelRefundPending).toBe(false);
  });

  test('LPS.6 an unauthorized intent buys no label and creates no order', async () => {
    const listing = await mkListing();
    const pi = authorizedPaymentIntent('requires_payment_method');

    const res = await confirmBatch(pi, [listing]);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(createShippingLabel).not.toHaveBeenCalled();
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
    expect(await Transaction.countDocuments({ buyer: buyer._id })).toBe(0);
  });

  test('LPS.8 cancel-payment releases only the buyer\'s own authorization', async () => {
    const own = authorizedPaymentIntent('requires_capture');
    global.__mockPaymentIntents[own].metadata.buyerId = String(buyer._id);
    const released = await request(app)
      .post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: own });
    expect(released.status).toBe(200);
    expect(released.body.released).not.toBe(false);
    expect(global.__mockPaymentIntents[own].status).not.toBe('requires_capture');

    const unknown = await request(app)
      .post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: `pi_unknown_${Date.now()}` });
    expect(unknown.status).toBe(200);
    expect(unknown.body.released).toBe(false);

    const foreign = authorizedPaymentIntent('requires_capture');
    global.__mockPaymentIntents[foreign].metadata.buyerId = String(seller._id);
    const rejected = await request(app)
      .post('/api/payments/cancel-payment')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ paymentIntentId: foreign });
    expect(rejected.status).toBe(403);
    expect(global.__mockPaymentIntents[foreign].status).toBe('requires_capture');
  });

  test('LPS.7 sandbox label failures expose the provider reason for diagnosis', async () => {
    const previousMode = process.env.EASYPOST_MODE;
    process.env.EASYPOST_MODE = 'sandbox';
    try {
      const listing = await mkListing();
      createShippingLabel.mockRejectedValueOnce(Object.assign(
        new Error('EasyPost request failed: Unable to verify address.'),
        { code: 'SHIPPING_LABEL_FAILED', status: 422 },
      ));
      const pi = await createIntent([listing]);

      const res = await confirmBatch(pi, [listing]);

      expect(res.status).toBe(502);
      expect(res.body.detail).toBe('EasyPost request failed: Unable to verify address.');
      expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
      expect(global.__mockPaymentIntents[pi].status).not.toBe('succeeded');
    } finally {
      if (previousMode === undefined) delete process.env.EASYPOST_MODE;
      else process.env.EASYPOST_MODE = previousMode;
    }
  });
});
