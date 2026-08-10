const request = require('supertest');
const app = require('../server');
const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');

// Webhook endpoint: POST /api/payments/webhook with raw JSON + stripe-signature
// header. jest.setup.js mocks the Stripe SDK: constructEvent(payload, sig)
// returns parsed JSON for any sig except 'bad' (which throws).
const postWebhook = (payload, sig = 'whsec_test_sig') =>
  request(app)
    .post('/api/payments/webhook')
    .set('stripe-signature', sig)
    .send(payload);

describe('Stripe webhook hardening (TD-1.1)', () => {
  let seller, buyer, listing, tx;

  beforeAll(async () => {
    seller = await User.create({
      name: 'Webhook Seller',
      email: 'webhook-seller@test.com',
      password: 'password123',
      role: 'user',
      balance: { pending: 100 },
    });
    buyer = await User.create({
      name: 'Webhook Buyer',
      email: 'webhook-buyer@test.com',
      password: 'password123',
      role: 'user',
    });
    listing = await Listing.create({
      seller: seller._id,
      title: 'Webhook Test Item',
      description: 'Item for webhook tests',
      price: 50,
      currency: 'USD',
      images: ['https://test.image.url/image1.jpg'],
      category: 'Women',
      condition: 'Good',
      available: true,
      quantity: 1,
    });
  });

  afterAll(async () => {
    await Transaction.deleteMany({});
    await Listing.deleteMany({});
    await User.deleteMany({});
  });

  beforeEach(async () => {
    await Transaction.deleteMany({});
    // Reset seller balance + notifications for deterministic assertions
    seller = await User.findById(seller._id);
    seller.balance.pending = 100;
    seller.notifications = [];
    await seller.save();
    tx = await Transaction.create({
      seller: seller._id,
      buyer: buyer._id,
      listing: listing._id,
      status: 'paid',
      itemPrice: 50,
      total: 60,
      paymentBreakdown: {
        subtotal: 50,
        totalPaid: 60,
        sellerEarnings: 45,
        platform: { commission: 4, stripeFee: 1.9, netRevenue: 2.1 },
      },
    });
  });

  describe('payment_intent.succeeded', () => {
    it('WH.1 attaches the payment intent id to a paid transaction', async () => {
      const res = await postWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_123', metadata: { transactionId: tx._id.toString() } } },
      });
      expect(res.status).toBe(200);
      const updated = await Transaction.findById(tx._id);
      expect(updated.stripePaymentIntentId).toBe('pi_test_123');
    });

    it('WH.2 malformed transactionId does not 500 (no CastError retry loop)', async () => {
      const res = await postWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_456', metadata: { transactionId: 'not-a-valid-objectid' } } },
      });
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it('WH.3 missing transactionId metadata is a no-op, not a 500', async () => {
      const res = await postWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_789', metadata: {} } },
      });
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });
  });

  describe('charge.dispute.created idempotency', () => {
    const createdEvent = {
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_test_1',
          payment_intent: 'pi_test_123',
          reason: 'fraudulent',
          status: 'needs_response',
          evidence_details: { due_by: 1893456000 },
        },
      },
    };

    it('WH.6 re-delivered dispute.created notifies the seller once', async () => {
      tx.stripePaymentIntentId = 'pi_test_123';
      await tx.save();

      const first = await postWebhook(createdEvent);
      expect(first.status).toBe(200);
      const dup = await postWebhook(createdEvent);
      expect(dup.status).toBe(200);

      const updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_open');
      expect(updated.disputeInfo.stripeDisputeId).toBe('dp_test_1');

      const s = await User.findById(seller._id);
      const disputeNotes = s.notifications.filter((n) => n.type === 'dispute');
      expect(disputeNotes.length).toBe(1);
    });
  });

  describe('charge.dispute.updated idempotency', () => {
    const disputeEvent = (status) => ({
      type: 'charge.dispute.updated',
      data: {
        object: {
          id: 'dp_test_1',
          payment_intent: 'pi_test_123',
          status,
          evidence_details: { due_by: 1893456000 },
        },
      },
    });

    it('WH.4 "won" re-delivery credits the seller exactly once', async () => {
      // Setup: transaction must have stripePaymentIntentId AND existing disputeInfo
      tx.stripePaymentIntentId = 'pi_test_123';
      tx.disputeInfo = {
        stripeDisputeId: 'dp_test_1',
        status: 'needs_response',
      };
      await tx.save();

      const first = await postWebhook(disputeEvent('won'));
      expect(first.status).toBe(200);

      // Stripe re-delivers the same event — must not credit again
      const dup = await postWebhook(disputeEvent('won'));
      expect(dup.status).toBe(200);

      const updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_won');
      expect(updated.disputeInfo.status).toBe('won');

      const s = await User.findById(seller._id);
      expect(s.balance.pending).toBe(145); // 100 + 45 exactly once
      const disputeNotes = s.notifications.filter((n) => n.type === 'dispute');
      // 1 notification from dispute.updated (won) — no created event in this setup
      expect(disputeNotes.length).toBe(1);
    });

    it('WH.5 "lost" re-delivery debits the seller exactly once', async () => {
      // Setup: transaction must have stripePaymentIntentId AND existing disputeInfo
      tx.stripePaymentIntentId = 'pi_test_123';
      tx.disputeInfo = {
        stripeDisputeId: 'dp_test_1',
        status: 'needs_response',
      };
      await tx.save();

      const first = await postWebhook(disputeEvent('lost'));
      expect(first.status).toBe(200);
      const dup = await postWebhook(disputeEvent('lost'));
      expect(dup.status).toBe(200);

      const updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_lost');

      const s = await User.findById(seller._id);
      expect(s.balance.pending).toBe(55); // 100 - 45 exactly once
      const disputeNotes = s.notifications.filter((n) => n.type === 'dispute');
      expect(disputeNotes.length).toBe(1);
    });
  });
});