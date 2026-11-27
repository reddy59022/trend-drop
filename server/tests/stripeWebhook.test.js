const request = require('supertest');
const app = require('../server');
const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Order = require('../models/Order');
const Payout = require('../models/Payout');
const Return = require('../models/Return');

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
    await Order.deleteMany({});
    await Payout.deleteMany({});
    await Return.deleteMany({});
    await Listing.deleteMany({});
    await User.deleteMany({});
  });

  beforeEach(async () => {
    await Transaction.deleteMany({});
    await Order.deleteMany({});
    await Payout.deleteMany({});
    await Return.deleteMany({});
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

    it('WH.9 reconciles transactions that store the intent in the payment breakdown', async () => {
      tx.paymentBreakdown.paymentIntentId = 'pi_breakdown_only';
      await tx.save();

      const res = await postWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_breakdown_only', metadata: {} } },
      });
      expect(res.status).toBe(200);
      const updated = await Transaction.findById(tx._id);
      expect(updated.stripePaymentIntentId).toBe('pi_breakdown_only');
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

    it('WH.4 "won" re-delivery does not pay the seller twice for the same sale', async () => {
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
      // The sale's earnings were already credited when the order was placed and
      // opening a dispute never debits them, so winning must not credit again.
      expect(s.balance.pending).toBe(100);
      const disputeNotes = s.notifications.filter((n) => n.type === 'dispute');
      // 1 notification from dispute.updated (won) — no created event in this setup
      expect(disputeNotes.length).toBe(1);
    });

    const closedEvent = (status, extra = {}) => ({
      type: 'charge.dispute.closed',
      data: {
        object: {
          id: 'dp_test_1',
          payment_intent: 'pi_test_123',
          status,
          evidence_details: { due_by: 1893456000 },
          ...extra,
        },
      },
    });

    it('WH.30 records the dispute fee at creation and keeps it when the dispute is won', async () => {
      tx.stripePaymentIntentId = 'pi_test_123';
      await tx.save();

      const created = await postWebhook({
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_test_1',
            payment_intent: 'pi_test_123',
            reason: 'fraudulent',
            status: 'needs_response',
            currency: 'usd',
            evidence_details: { due_by: 1893456000 },
            balance_transactions: [{ fee: 1500, currency: 'usd' }],
          },
        },
      });
      expect(created.status).toBe(200);

      let updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_open');
      expect(updated.disputeInfo.feeAmount).toBe(15);
      expect(updated.disputeInfo.feeCurrency).toBe('USD');
      expect(updated.disputeInfo.lostSettlement?.earnings).toBeUndefined();
      expect(updated.disputeInfo.lostSettlement?.released).toBeUndefined();
      let s = await User.findById(seller._id);
      expect(s.balance.pending).toBe(100); // creation never debits

      // Stripe's won payload need not repeat balance_transactions; the
      // creation-time fee must survive.
      const won = await postWebhook(closedEvent('won'));
      expect(won.status).toBe(200);
      updated = await Transaction.findById(tx._id);
      s = await User.findById(seller._id);
      expect(updated.status).toBe('chargeback_won');
      expect(updated.disputeInfo.feeAmount).toBe(15);
      expect(updated.disputeInfo.feeCurrency).toBe('USD');
      expect(updated.disputeInfo.lostSettlement?.earnings).toBeUndefined();
      expect(updated.disputeInfo.lostSettlement?.released).toBeUndefined();
      expect(s.balance.pending).toBe(100);
      expect(s.notifications.filter((n) => n.type === 'dispute').length).toBe(2);
    });

    it('WH.31 closed(won) books a fee when the created event was missed', async () => {
      tx.status = 'chargeback_open';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'under_review' };
      await tx.save();

      const res = await postWebhook(closedEvent('won', {
        balance_transactions: [{ fee: 1500, currency: 'usd' }],
      }));
      expect(res.status).toBe(200);

      const updated = await Transaction.findById(tx._id);
      const s = await User.findById(seller._id);
      expect(updated.status).toBe('chargeback_won');
      expect(updated.disputeInfo.feeAmount).toBe(15);
      expect(updated.disputeInfo.feeCurrency).toBe('USD');
      expect(updated.disputeInfo.lostSettlement?.earnings).toBeUndefined();
      expect(updated.disputeInfo.lostSettlement?.released).toBeUndefined();
      expect(s.balance.pending).toBe(100);
      expect(s.notifications.filter((n) => n.type === 'dispute').length).toBe(1);
    });

    it('WH.15 closed(won) settles the order without crediting the sale twice', async () => {
      // Stripe's real lifecycle: created → updated(under_review) →
      // funds_reinstated → closed(won). No updated event carries 'won'.
      tx.status = 'chargeback_open';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'under_review' };
      await tx.save();

      const first = await postWebhook(closedEvent('won'));
      expect(first.status).toBe(200);
      let updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_won');
      expect(updated.disputeInfo.status).toBe('won');
      expect(updated.disputeInfo.closedAt).toBeTruthy();
      let s = await User.findById(seller._id);
      expect(s.balance.pending).toBe(100);
      expect(s.notifications.filter((n) => n.type === 'dispute').length).toBe(1);
      const closedAt = updated.disputeInfo.closedAt;

      const replay = await postWebhook(closedEvent('won'));
      expect(replay.status).toBe(200);
      updated = await Transaction.findById(tx._id);
      s = await User.findById(seller._id);
      expect(updated.status).toBe('chargeback_won');
      expect(String(updated.disputeInfo.closedAt)).toBe(String(closedAt));
      expect(s.balance.pending).toBe(100);
      expect(s.notifications.filter((n) => n.type === 'dispute').length).toBe(1);
    });

    it('WH.16 closed(lost) debits the seller exactly once', async () => {
      tx.status = 'chargeback_open';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'needs_response' };
      await tx.save();

      const first = await postWebhook(closedEvent('lost'));
      expect(first.status).toBe(200);
      let updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_lost');
      let s = await User.findById(seller._id);
      expect(s.balance.pending).toBe(55); // 100 - 45 exactly once
      expect(s.notifications.filter((n) => n.type === 'dispute').length).toBe(1);

      const replay = await postWebhook(closedEvent('lost'));
      expect(replay.status).toBe(200);
      updated = await Transaction.findById(tx._id);
      s = await User.findById(seller._id);
      expect(updated.status).toBe('chargeback_lost');
      expect(s.balance.pending).toBe(55);
      expect(s.notifications.filter((n) => n.type === 'dispute').length).toBe(1);
    });

    it('WH.17 the real created/under_review/closed(won) sequence settles once', async () => {
      tx.status = 'chargeback_open';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'needs_response' };
      await tx.save();

      const progress = await postWebhook(disputeEvent('under_review'));
      expect(progress.status).toBe(200);
      let updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_open');
      expect(updated.disputeInfo.status).toBe('under_review');

      await postWebhook(closedEvent('won'));
      await postWebhook(closedEvent('won'));
      updated = await Transaction.findById(tx._id);
      const s = await User.findById(seller._id);
      expect(updated.status).toBe('chargeback_won');
      expect(updated.disputeInfo.status).toBe('won');
      expect(s.balance.pending).toBe(100);
      expect(s.notifications.filter((n) => n.type === 'dispute').length).toBe(1);
    });

    it('WH.7 provider refund reverses escrow without taking unrelated available funds and restores full quantity', async () => {
      tx.stripePaymentIntentId = 'pi_refund_123';
      tx.quantity = 3;
      tx.paymentBreakdown.sellerEarnings = 45;
      await tx.save();

      await User.updateOne({ _id: seller._id }, { $set: { 'balance.pending': 100, 'balance.available': 80 } });
      await Listing.updateOne({ _id: listing._id }, {
        $set: { quantity: 0, quantitySold: 3, sold: true, available: false },
      });

      const res = await postWebhook({
        type: 'charge.refunded',
        data: { object: { payment_intent: 'pi_refund_123' } },
      });
      expect(res.status).toBe(200);

      const sellerAfter = await User.findById(seller._id);
      expect(sellerAfter.balance.available).toBe(80);
      expect(sellerAfter.balance.pending).toBe(55);
      const listingAfter = await Listing.findById(listing._id);
      expect(listingAfter.quantity).toBe(3);
      expect(listingAfter.quantitySold).toBe(0);
      expect(listingAfter.available).toBe(true);
      expect(listingAfter.sold).toBe(false);
    });

    it('WH.26 a lost chargeback closes an in-progress return', async () => {
      tx.stripePaymentIntentId = 'pi_lost_return';
      tx.status = 'chargeback_open';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'under_review' };
      await tx.save();
      const returnRequest = await Return.create({
        transaction: tx._id,
        buyer: buyer._id,
        seller: seller._id,
        listing: listing._id,
        reason: 'Defective',
        status: 'in_transit',
      });

      const res = await postWebhook(closedEvent('lost'));
      expect(res.status).toBe(200);

      const closed = await Return.findById(returnRequest._id);
      expect(closed.status).toBe('refunded');
      expect(closed.closedByChargeback).toBe(true);
      expect(closed.chargebackClosedAt).toBeTruthy();
      expect(closed.refundAmount).toBe(60);
    });

    it('WH.27 a replay after a crash following the status claim finishes fee, stats, return and ledger exactly once', async () => {
      // Simulate the exact crash window: the status claim and its persisted
      // settlement inputs landed, but none of the effects did.
      tx.status = 'chargeback_lost';
      tx.payout = { status: 'refunded' };
      tx.disputeInfo = {
        stripeDisputeId: 'dp_test_1',
        status: 'lost',
        wasReleased: true,
        lostSettlement: { earnings: 45, released: true, refundAmount: 60 },
      };
      await tx.save();
      const payoutDoc = await Payout.create({
        seller: seller._id,
        transaction: tx._id,
        listing: listing._id,
        salePrice: 50,
        commissionRate: 0.08,
        commissionAmount: 4,
        payoutAmount: 45,
        status: 'pending',
      });
      const order = await Order.create({
        buyer: buyer._id,
        sellers: [seller._id],
        status: 'confirmed',
        items: [{ listing: listing._id, transaction: tx._id, seller: seller._id, title: listing.title, price: 50 }],
        shipments: [{ seller: seller._id, items: [tx._id], status: 'confirmed' }],
        payment: { paymentIntentId: 'pi_test_123', status: 'captured', totalHeld: 60 },
        totals: { subtotal: 50, total: 60 },
      });
      const returnRequest = await Return.create({
        transaction: tx._id,
        buyer: buyer._id,
        seller: seller._id,
        listing: listing._id,
        reason: 'Defective',
        status: 'in_transit',
      });
      await User.updateOne({ _id: seller._id }, {
        $set: {
          'balance.available': 80,
          'balance.pending': 100,
          'stats.totalSales': 5,
          notifications: [],
        },
      });

      const event = closedEvent('lost', {
        balance_transactions: [{ fee: 1500, currency: 'usd' }],
      });
      const res = await postWebhook(event);
      expect(res.status).toBe(200);

      let s = await User.findById(seller._id);
      let updated = await Transaction.findById(tx._id);
      expect(updated.disputeInfo.feeAmount).toBe(15);
      expect(updated.disputeInfo.feeCurrency).toBe('USD');
      expect(s.balance.available).toBe(35);
      expect(s.balance.pending).toBe(100);
      expect(s.stats.totalSales).toBe(4);
      expect(s.notifications.filter((n) => n.type === 'dispute')).toHaveLength(1);
      expect((await Payout.findById(payoutDoc._id)).status).toBe('refunded');
      expect((await Order.findById(order._id)).status).toBe('refunded');
      const closedReturn = await Return.findById(returnRequest._id);
      expect(closedReturn.status).toBe('refunded');
      expect(closedReturn.closedByChargeback).toBe(true);

      const replay = await postWebhook(event);
      expect(replay.status).toBe(200);
      s = await User.findById(seller._id);
      updated = await Transaction.findById(tx._id);
      expect(updated.disputeInfo.feeAmount).toBe(15);
      expect(s.balance.available).toBe(35);
      expect(s.balance.pending).toBe(100);
      expect(s.stats.totalSales).toBe(4);
      expect(s.notifications.filter((n) => n.type === 'dispute')).toHaveLength(1);
    });

    it('WH.28 a completed sale stays released after dispute.created overwrites its status', async () => {
      tx.stripePaymentIntentId = 'pi_test_123';
      tx.status = 'completed';
      // Deliberately NOT completed: completion paths need not stamp the payout,
      // so the persisted release marker must carry the decision.
      tx.payout = { status: 'pending' };
      await tx.save();
      await User.updateOne({ _id: seller._id }, {
        $set: { 'balance.available': 80, 'balance.pending': 100, 'stats.totalSales': 5 },
      });

      const created = await postWebhook({
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
      });
      expect(created.status).toBe(200);
      let updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_open');
      expect(updated.disputeInfo.wasReleased).toBe(true);

      const res = await postWebhook(closedEvent('lost'));
      expect(res.status).toBe(200);
      const s = await User.findById(seller._id);
      updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_lost');
      expect(updated.disputeInfo.lostSettlement.released).toBe(true);
      expect(s.balance.available).toBe(35); // clawed from released funds
      expect(s.balance.pending).toBe(100);
      expect(s.stats.totalSales).toBe(4);
    });

    it('WH.20 a lost chargeback reverses the parent order and replay is idempotent', async () => {
      tx.stripePaymentIntentId = 'pi_test_123';
      tx.status = 'chargeback_open';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'under_review' };
      await tx.save();
      await User.updateOne({ _id: seller._id }, { $set: { 'stats.totalSales': 5 } });
      const order = await Order.create({
        buyer: buyer._id,
        sellers: [seller._id],
        status: 'confirmed',
        items: [{ listing: listing._id, transaction: tx._id, seller: seller._id, title: listing.title, price: 50 }],
        shipments: [{ seller: seller._id, items: [tx._id], status: 'confirmed' }],
        payment: { paymentIntentId: 'pi_test_123', status: 'captured', totalHeld: 60 },
        totals: { subtotal: 50, total: 60 },
      });

      const first = await postWebhook(closedEvent('lost'));
      expect(first.status).toBe(200);

      let synced = await Order.findById(order._id);
      expect(synced.status).toBe('refunded');
      expect(synced.payment.status).toBe('refunded');
      expect(synced.items).toHaveLength(0);
      expect(synced.shipments[0].status).toBe('cancelled');
      expect(synced.shipments[0].items).toHaveLength(0);
      expect(synced.cancellation.refundAmount).toBe(60);
      expect((await User.findById(seller._id)).stats.totalSales).toBe(5); // never released, never counted

      const replay = await postWebhook(closedEvent('lost'));
      expect(replay.status).toBe(200);
      synced = await Order.findById(order._id);
      const s = await User.findById(seller._id);
      expect(synced.cancellation.refundAmount).toBe(60);
      expect(s.balance.pending).toBe(55); // debited once
      expect(s.stats.totalSales).toBe(5);
    });

    it('WH.29 a replay of a pre-marker lost settlement never debits the seller again', async () => {
      // Shape of a row settled by the previous release: terminal status,
      // release state recorded, fee/return/order/payout already handled, but
      // no `lostSettlement` inputs and no `balance.chargebackSettlements`
      // marker. A replay must heal non-money effects without touching the
      // ledger or sales count.
      tx.stripePaymentIntentId = 'pi_test_123';
      tx.status = 'chargeback_lost';
      tx.payout = { status: 'refunded' };
      tx.disputeInfo = {
        stripeDisputeId: 'dp_test_1',
        status: 'lost',
        wasReleased: true,
      };
      await tx.save();
      const payoutDoc = await Payout.create({
        seller: seller._id,
        transaction: tx._id,
        listing: listing._id,
        salePrice: 50,
        commissionRate: 0.08,
        commissionAmount: 4,
        payoutAmount: 45,
        status: 'refunded',
      });
      const order = await Order.create({
        buyer: buyer._id,
        sellers: [seller._id],
        status: 'refunded',
        items: [],
        shipments: [],
        payment: { paymentIntentId: 'pi_test_123', status: 'captured', totalHeld: 60 },
        totals: { subtotal: 50, total: 60 },
      });
      const returnRequest = await Return.create({
        transaction: tx._id,
        buyer: buyer._id,
        seller: seller._id,
        listing: listing._id,
        reason: 'Defective',
        status: 'refunded',
        refundAmount: 60,
        closedByChargeback: true,
        chargebackClosedAt: new Date(),
      });
      await User.updateOne({ _id: seller._id }, {
        $set: {
          'balance.available': 35,
          'balance.pending': 100,
          'stats.totalSales': 4,
          notifications: [{
            type: 'dispute',
            message: 'Chargeback lost. The sale amount has been deducted from your balance.',
          }],
        },
      });

      const event = closedEvent('lost', {
        balance_transactions: [{ fee: 1500, currency: 'usd' }],
      });
      const res = await postWebhook(event);
      expect(res.status).toBe(200);

      let s = await User.findById(seller._id);
      let updated = await Transaction.findById(tx._id);
      expect(updated.disputeInfo.feeAmount).toBe(15); // non-money heal still runs
      expect(s.balance.available).toBe(35);
      expect(s.balance.pending).toBe(100);
      expect(s.stats.totalSales).toBe(4);
      expect(s.notifications.filter((n) => n.type === 'dispute')).toHaveLength(1);
      expect((await Payout.findById(payoutDoc._id)).status).toBe('refunded');
      expect((await Order.findById(order._id)).status).toBe('refunded');
      expect((await Return.findById(returnRequest._id)).status).toBe('refunded');

      const replay = await postWebhook(event);
      expect(replay.status).toBe(200);
      s = await User.findById(seller._id);
      updated = await Transaction.findById(tx._id);
      expect(updated.disputeInfo.feeAmount).toBe(15);
      expect(s.balance.available).toBe(35);
      expect(s.balance.pending).toBe(100);
      expect(s.stats.totalSales).toBe(4);
      expect(s.notifications.filter((n) => n.type === 'dispute')).toHaveLength(1);
    });

    it('WH.21 a replay heals an order left confirmed by an earlier lost settlement', async () => {
      // Simulates a crash after the status/ledger claim but before the order sync.
      tx.stripePaymentIntentId = 'pi_test_123';
      tx.status = 'chargeback_lost';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'lost' };
      await tx.save();
      const order = await Order.create({
        buyer: buyer._id,
        sellers: [seller._id],
        status: 'confirmed',
        items: [{ listing: listing._id, transaction: tx._id, seller: seller._id, title: listing.title, price: 50 }],
        shipments: [{ seller: seller._id, items: [tx._id], status: 'confirmed' }],
        payment: { paymentIntentId: 'pi_test_123', status: 'captured', totalHeld: 60 },
        totals: { subtotal: 50, total: 60 },
      });

      const res = await postWebhook(closedEvent('lost'));
      expect(res.status).toBe(200);

      const synced = await Order.findById(order._id);
      expect(synced.status).toBe('refunded');
      expect(synced.items).toHaveLength(0);
      expect(synced.cancellation.refundAmount).toBe(60);
    });

    it('WH.22 a lost chargeback after release claws available funds and refunds the payout record', async () => {
      tx.stripePaymentIntentId = 'pi_lost_released';
      tx.status = 'completed';
      tx.payout.status = 'completed';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'under_review' };
      await tx.save();
      const payoutDoc = await Payout.create({
        seller: seller._id,
        transaction: tx._id,
        listing: listing._id,
        salePrice: 50,
        commissionRate: 0.08,
        commissionAmount: 4,
        payoutAmount: 45,
        status: 'completed',
      });
      const order = await Order.create({
        buyer: buyer._id,
        sellers: [seller._id],
        status: 'completed',
        items: [{ listing: listing._id, transaction: tx._id, seller: seller._id, title: listing.title, price: 50 }],
        shipments: [{ seller: seller._id, items: [tx._id], status: 'confirmed' }],
        payment: { paymentIntentId: 'pi_lost_released', status: 'captured', totalHeld: 60 },
        totals: { subtotal: 50, total: 60 },
      });
      await User.updateOne({ _id: seller._id }, {
        $set: { 'balance.available': 80, 'balance.pending': 100, 'stats.totalSales': 5 },
      });

      const lostWithFee = closedEvent('lost', {
        balance_transactions: [{ fee: 1500, currency: 'usd' }],
      });
      const res = await postWebhook(lostWithFee);
      expect(res.status).toBe(200);

      const updated = await Transaction.findById(tx._id);
      let s = await User.findById(seller._id);
      expect(updated.status).toBe('chargeback_lost');
      expect(updated.payout.status).toBe('refunded');
      expect(updated.disputeInfo.feeAmount).toBe(15);
      expect(updated.disputeInfo.feeCurrency).toBe('USD');
      expect(s.balance.available).toBe(35); // 80 - 45, not left withdrawable
      expect(s.balance.pending).toBe(100);
      expect(s.stats.totalSales).toBe(4); // released sale reversed
      expect((await Payout.findById(payoutDoc._id)).status).toBe('refunded');
      expect((await Order.findById(order._id)).status).toBe('refunded');

      const replay = await postWebhook(lostWithFee);
      expect(replay.status).toBe(200);
      s = await User.findById(seller._id);
      expect(s.balance.available).toBe(35);
      expect(s.balance.pending).toBe(100);
      expect(s.stats.totalSales).toBe(4);
    });

    it('WH.23 a lost chargeback after withdrawal records a negative receivable without restocking', async () => {
      tx.stripePaymentIntentId = 'pi_lost_withdrawn';
      tx.status = 'completed';
      tx.payout.status = 'completed';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'under_review' };
      await tx.save();
      await User.updateOne({ _id: seller._id }, {
        $set: { 'balance.available': 0, 'balance.pending': 0, 'stats.totalSales': 5 },
      });
      await Listing.updateOne({ _id: listing._id }, {
        $set: { quantity: 0, quantitySold: 1, sold: true, available: false },
      });

      const res = await postWebhook(closedEvent('lost'));
      expect(res.status).toBe(200);

      const s = await User.findById(seller._id);
      expect(s.balance.available).toBe(0);
      expect(s.balance.pending).toBe(-45); // seller owes the platform
      expect(s.stats.totalSales).toBe(4);
      const listingAfter = await Listing.findById(listing._id);
      expect(listingAfter.quantity).toBe(0);
      expect(listingAfter.quantitySold).toBe(1);
      expect(listingAfter.sold).toBe(true);
    });

    it('WH.24 a lost item in a consolidated order leaves the other shipment active', async () => {
      tx.stripePaymentIntentId = 'pi_lost_multi';
      tx.status = 'chargeback_open';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'under_review' };
      await tx.save();
      const secondListing = await Listing.create({
        seller: seller._id,
        title: 'Webhook Second Item',
        description: 'Second item',
        price: 20,
        currency: 'USD',
        images: [],
        category: 'Men',
        condition: 'Good',
        available: true,
        quantity: 1,
      });
      const secondTxn = await Transaction.create({
        seller: seller._id,
        buyer: buyer._id,
        listing: secondListing._id,
        status: 'shipped',
        itemPrice: 20,
        total: 20,
        paymentBreakdown: { subtotal: 20, totalPaid: 20, sellerEarnings: 18 },
      });
      const order = await Order.create({
        buyer: buyer._id,
        sellers: [seller._id],
        status: 'shipped',
        items: [
          { listing: listing._id, transaction: tx._id, seller: seller._id, title: listing.title, price: 50 },
          { listing: secondListing._id, transaction: secondTxn._id, seller: seller._id, title: secondListing.title, price: 20 },
        ],
        shipments: [
          { seller: seller._id, items: [tx._id], status: 'confirmed' },
          { seller: seller._id, items: [secondTxn._id], status: 'shipped' },
        ],
        payment: { paymentIntentId: 'pi_lost_multi', status: 'captured', totalHeld: 70 },
        totals: { subtotal: 70, total: 70 },
      });

      const res = await postWebhook(closedEvent('lost'));
      expect(res.status).toBe(200);

      const synced = await Order.findById(order._id);
      expect(synced.items).toHaveLength(1);
      expect(String(synced.items[0].transaction)).toBe(String(secondTxn._id));
      expect(synced.shipments[0].status).toBe('cancelled');
      expect(synced.shipments[1].status).toBe('shipped');
      expect(synced.status).toBe('shipped');
      expect(synced.cancellation.refundAmount).toBe(60);
    });

    it('WH.25 concurrent lost deliveries debit and reconcile exactly once', async () => {
      tx.stripePaymentIntentId = 'pi_lost_concurrent';
      tx.status = 'chargeback_open';
      tx.disputeInfo = { stripeDisputeId: 'dp_test_1', status: 'under_review' };
      await tx.save();
      const order = await Order.create({
        buyer: buyer._id,
        sellers: [seller._id],
        status: 'confirmed',
        items: [{ listing: listing._id, transaction: tx._id, seller: seller._id, title: listing.title, price: 50 }],
        shipments: [{ seller: seller._id, items: [tx._id], status: 'confirmed' }],
        payment: { paymentIntentId: 'pi_lost_concurrent', status: 'captured', totalHeld: 60 },
        totals: { subtotal: 50, total: 60 },
      });

      const responses = await Promise.all([
        postWebhook(closedEvent('lost')),
        postWebhook(closedEvent('lost')),
      ]);
      responses.forEach((res) => expect(res.status).toBe(200));

      const s = await User.findById(seller._id);
      expect(s.balance.pending).toBe(55); // 100 - 45 once
      const synced = await Order.findById(order._id);
      expect(synced.status).toBe('refunded');
      expect(synced.cancellation.refundAmount).toBe(60);
    });

    it('WH.18 provider refund marks the parent order refunded and is replay-safe', async () => {
      tx.stripePaymentIntentId = 'pi_refund_order';
      await tx.save();
      const order = await Order.create({
        buyer: buyer._id,
        sellers: [seller._id],
        status: 'confirmed',
        items: [{ listing: listing._id, transaction: tx._id, seller: seller._id, title: listing.title, price: 50 }],
        shipments: [{ seller: seller._id, items: [tx._id], status: 'confirmed' }],
        payment: { paymentIntentId: 'pi_refund_order', status: 'captured', totalHeld: 60 },
        totals: { subtotal: 50, total: 60 },
      });

      const res = await postWebhook({
        type: 'charge.refunded',
        data: { object: { payment_intent: 'pi_refund_order' } },
      });
      expect(res.status).toBe(200);

      let synced = await Order.findById(order._id);
      expect(synced.status).toBe('refunded');
      expect(synced.payment.status).toBe('refunded');
      expect(synced.items).toHaveLength(0);
      expect(synced.shipments[0].status).toBe('cancelled');
      expect(synced.shipments[0].items).toHaveLength(0);
      expect(synced.cancellation.refundAmount).toBe(60);

      // A provider retry reaches the already-unwound branch; it must re-sync
      // the order without accumulating the refund a second time.
      const replay = await postWebhook({
        type: 'charge.refunded',
        data: { object: { payment_intent: 'pi_refund_order' } },
      });
      expect(replay.status).toBe(200);
      synced = await Order.findById(order._id);
      expect(synced.status).toBe('refunded');
      expect(synced.cancellation.refundAmount).toBe(60);
    });

    it('WH.19 provider retry heals an order left confirmed by an internal refund', async () => {
      tx.stripePaymentIntentId = 'pi_refund_stale_order';
      tx.status = 'cancelled_by_buyer';
      tx.cancellation = {
        cancelledBy: 'buyer',
        reason: 'Changed mind',
        cancelledAt: new Date(),
        refundAmount: 60,
      };
      await tx.save();
      const order = await Order.create({
        buyer: buyer._id,
        sellers: [seller._id],
        status: 'confirmed',
        items: [{ listing: listing._id, transaction: tx._id, seller: seller._id, title: listing.title, price: 50 }],
        shipments: [{ seller: seller._id, items: [tx._id], status: 'confirmed' }],
        payment: { paymentIntentId: 'pi_refund_stale_order', status: 'captured', totalHeld: 60 },
        totals: { subtotal: 50, total: 60 },
      });

      const res = await postWebhook({
        type: 'charge.refunded',
        data: { object: { payment_intent: 'pi_refund_stale_order' } },
      });
      expect(res.status).toBe(200);

      const synced = await Order.findById(order._id);
      expect(synced.status).toBe('refunded');
      expect(synced.items).toHaveLength(0);
      expect(synced.cancellation.refundAmount).toBe(60);
    });

    it('WH.12 provider refund after an internal cancellation does not unwind twice', async () => {
      tx.stripePaymentIntentId = 'pi_refund_cancelled';
      tx.status = 'cancelled_by_buyer';
      tx.quantity = 3;
      tx.cancellation = {
        cancelledBy: 'buyer',
        reason: 'Changed mind',
        cancelledAt: new Date(),
        refundAmount: 60,
      };
      await tx.save();

      await User.updateOne({ _id: seller._id }, { $set: { 'balance.pending': 0 } });
      await Listing.updateOne({ _id: listing._id }, {
        $set: { quantity: 3, quantitySold: 0, sold: false, available: true },
      });

      const res = await postWebhook({
        type: 'charge.refunded',
        data: { object: { payment_intent: 'pi_refund_cancelled' } },
      });
      expect(res.status).toBe(200);

      const sellerAfter = await User.findById(seller._id);
      expect(sellerAfter.balance.pending).toBe(0);
      const listingAfter = await Listing.findById(listing._id);
      expect(listingAfter.quantity).toBe(3);
      expect(listingAfter.quantitySold).toBe(0);
      expect((await Transaction.findById(tx._id)).status).toBe('cancelled_by_buyer');
    });

    it('WH.8 provider refund after release claws back available seller earnings', async () => {
      tx.stripePaymentIntentId = 'pi_refund_released';
      tx.status = 'completed';
      tx.payout.status = 'completed';
      await tx.save();
      await User.updateOne({ _id: seller._id }, { $set: { 'balance.pending': 100, 'balance.available': 80 } });

      const res = await postWebhook({
        type: 'charge.refunded',
        data: { object: { payment_intent: 'pi_refund_released' } },
      });
      expect(res.status).toBe(200);

      const sellerAfter = await User.findById(seller._id);
      expect(sellerAfter.balance.available).toBe(35);
      expect(sellerAfter.balance.pending).toBe(100);
    });

    it('WH.10 provider refunds reconcile transactions using the canonical breakdown intent id', async () => {
      tx.paymentBreakdown.paymentIntentId = 'pi_breakdown_refund';
      tx.quantity = 2;
      await tx.save();
      await Listing.updateOne({ _id: listing._id }, {
        $set: { quantity: 0, quantitySold: 2, sold: true, available: false },
      });

      const res = await postWebhook({
        type: 'charge.refunded',
        data: { object: { payment_intent: 'pi_breakdown_refund' } },
      });
      expect(res.status).toBe(200);
      expect((await Transaction.findById(tx._id)).status).toBe('refunded');
      expect((await Listing.findById(listing._id)).quantity).toBe(2);
    });

    it('WH.11 concurrent provider refund deliveries reverse the ledger exactly once', async () => {
      tx.stripePaymentIntentId = 'pi_refund_concurrent';
      tx.quantity = 2;
      await tx.save();
      await User.updateOne({ _id: seller._id }, { $set: { 'balance.pending': 100, 'balance.available': 0 } });
      await Listing.updateOne({ _id: listing._id }, {
        $set: { quantity: 0, quantitySold: 2, sold: true, available: false },
      });

      const responses = await Promise.all([
        postWebhook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_refund_concurrent' } } }),
        postWebhook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_refund_concurrent' } } }),
      ]);
      responses.forEach((res) => expect(res.status).toBe(200));

      const sellerAfter = await User.findById(seller._id);
      const listingAfter = await Listing.findById(listing._id);
      expect(sellerAfter.balance.pending).toBe(55);
      expect(listingAfter.quantity).toBe(2);
      expect(listingAfter.quantitySold).toBe(0);
    });

    it('WH.13 a replayed created event cannot reopen a resolved dispute', async () => {
      tx.stripePaymentIntentId = 'pi_test_123';
      tx.status = 'chargeback_won';
      tx.disputeInfo = {
        stripeDisputeId: 'dp_test_1',
        status: 'won',
      };
      await tx.save();
      const pendingBefore = (await User.findById(seller._id)).balance.pending;

      const replay = await postWebhook({
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
      });
      expect(replay.status).toBe(200);

      const updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_won');
      expect(updated.disputeInfo.status).toBe('won');
      expect((await User.findById(seller._id)).balance.pending).toBe(pendingBefore);
    });

    it('WH.14 a stale lost update cannot debit after the dispute was won', async () => {
      tx.stripePaymentIntentId = 'pi_test_123';
      tx.status = 'chargeback_won';
      tx.disputeInfo = {
        stripeDisputeId: 'dp_test_1',
        status: 'won',
      };
      await tx.save();

      const stale = await postWebhook(disputeEvent('lost'));
      expect(stale.status).toBe(200);

      const updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe('chargeback_won');
      expect(updated.disputeInfo.status).toBe('won');
      expect((await User.findById(seller._id)).balance.pending).toBe(100);
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