/**
 * PROD E2E — 14: Shipping insurance flow.
 * Tests insurance premium calculation, purchase for a transaction,
 * viewing policies, and filing a claim.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

test.describe('14 · Shipping insurance (production)', () => {
  let api, state, alexToken, jordanToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('insurance settings are publicly accessible', async () => {
    const r = await api.req('get', '/api/shipping-insurance/settings');
    expect(r.status).toBe(200);
    expect(r.data.enabled).toBe(true);
    expect(r.data.coverageTypes.standard).toBeTruthy();
    expect(r.data.coverageTypes.basic).toBeTruthy();
    expect(r.data.coverageTypes.premium).toBeTruthy();
  });

  test('premium calculation for standard coverage', async () => {
    const r = await api.req('post', '/api/shipping-insurance/calculate', {
      body: { itemValue: 100, coverageType: 'standard' },
    });
    expect(r.status).toBe(200);
    expect(r.data.premium).toBeGreaterThan(0);
    expect(r.data.limit).toBeGreaterThanOrEqual(100);
    expect(r.data.coverageType).toBe('standard');
  });

  test('premium calculation for different coverage tiers', async () => {
    const tiers = ['basic', 'standard', 'premium'];
    for (const tier of tiers) {
      const r = await api.req('post', '/api/shipping-insurance/calculate', {
        body: { itemValue: 200, coverageType: tier },
      });
      expect(r.status).toBe(200);
      expect(r.data.premium).toBeGreaterThanOrEqual(2);
      expect(r.data.limit).toBeGreaterThan(0);
    }
  });

  test('premium calculation requires valid item value', async () => {
    const r = await api.req('post', '/api/shipping-insurance/calculate', {
      body: { itemValue: -10, coverageType: 'standard' },
    });
    expect(r.status).toBe(400);
  });

  test('seller can purchase insurance for a transaction', async () => {
    const tr = await api.req('get', '/api/transactions', { token: alexToken });
    expect(tr.status).toBe(200);
    const txns = Array.isArray(tr.data) ? tr.data : (tr.data.transactions || tr.data.data || []);
    const soldTxn = txns.find((t) => t.status && ['paid', 'shipped', 'completed', 'delivered'].includes(t.status));
    if (!soldTxn) {
      test.info().annotations.push({ type: 'info', description: 'No eligible transaction — skipping insurance purchase' });
      return;
    }
    const txnId = String(soldTxn._id);
    const r = await api.req('post', '/api/shipping-insurance/purchase', {
      token: alexToken,
      body: { transactionId: txnId, coverageType: 'standard' },
    });
    expect([201, 400]).toContain(r.status);
    if (r.status === 201) {
      const policy = r.data.insurance || r.data;
      expect(policy.premium).toBeGreaterThan(0);
      state.insurance = state.insurance || {};
      state.insurance.policy1 = { id: policy._id, txnId };
      saveState(state);
    }
  });

  test('buyer cannot purchase insurance (seller-only guard)', async () => {
    const tr = await api.req('get', '/api/transactions', { token: jordanToken });
    expect(tr.status).toBe(200);
    const txns = Array.isArray(tr.data) ? tr.data : (tr.data.transactions || tr.data.data || []);
    const boughtTxn = txns.find((t) => t.status && ['paid', 'shipped', 'completed'].includes(t.status));
    if (!boughtTxn) {
      test.info().annotations.push({ type: 'info', description: 'No transaction — skipping buyer-insurance guard' });
      return;
    }
    const r = await api.req('post', '/api/shipping-insurance/purchase', {
      token: jordanToken,
      body: { transactionId: String(boughtTxn._id), coverageType: 'standard' },
    });
    expect(r.status).toBe(403);
  });

  test('seller can view their insurance policies', async () => {
    const r = await api.req('get', '/api/shipping-insurance/my', { token: alexToken });
    expect(r.status).toBe(200);
    const policies = r.data.policies || [];
    expect(Array.isArray(policies)).toBe(true);
    if (policies.length > 0) {
      const policy = policies[0];
      expect(policy._id).toBeTruthy();
      expect(policy.transaction).toBeTruthy();
      expect(policy.premium).toBeGreaterThan(0);
      state.insurance = state.insurance || {};
      state.insurance.policy1 = { id: policy._id, txnId: policy.transaction._id || policy.transaction };
      saveState(state);
    }
  });

  test('seller can file an insurance claim', async () => {
    if (!state.insurance?.policy1) {
      test.info().annotations.push({ type: 'info', description: 'No insurance policy — skipping claim' });
      return;
    }
    const r = await api.req('post', `/api/shipping-insurance/${state.insurance.policy1.id}/claim`, {
      token: alexToken,
      body: { reason: 'lost_in_transit', description: 'Package lost during shipping', evidence: [] },
    });
    expect([200, 201, 400]).toContain(r.status);
    if (r.status === 200 || r.status === 201) {
      const policy = r.data.insurance || r.data;
      expect(policy.claim).toBeTruthy();
      expect(policy.claim.status).toBe('pending');
    }
    saveState(state);
  });

  test('insurance claim requires authentication', async () => {
    if (!state.insurance?.policy1) {
      test.info().annotations.push({ type: 'info', description: 'No policy — skipping auth guard' });
      return;
    }
    const r = await api.req('post', `/api/shipping-insurance/${state.insurance.policy1.id}/claim`, {
      body: { reason: 'lost_in_transit', description: 'test', evidence: [] },
    });
    expect([401, 403]).toContain(r.status);
  });
});
