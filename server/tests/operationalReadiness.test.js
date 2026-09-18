const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');

describe('Operational readiness and reconciliation contracts', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
    } else if (mongoose.connection.readyState !== 1) {
      await mongoose.connection.asPromise();
    }
  });

  test('readiness reports a connected database separately from liveness', async () => {
    const response = await request(app).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ready', mongo: 'connected' });
    expect(response.body.uptime).toEqual(expect.any(Number));
  });

  test('payment reconciliation fields have indexes for retry/webhook lookups', () => {
    const transactionIndexes = Transaction.schema.indexes().map(([fields]) => fields);
    const payoutIndexes = Payout.schema.indexes().map(([fields]) => fields);

    expect(transactionIndexes).toEqual(expect.arrayContaining([
      { stripePaymentIntentId: 1 },
      { 'paymentBreakdown.paymentIntentId': 1 },
    ]));
    expect(payoutIndexes).toEqual(expect.arrayContaining([
      { paymentIntentId: 1 },
    ]));
  });

  test('existing liveness endpoint does not depend on database availability', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(mongoose.connection.readyState).toBe(1);
  });
});
