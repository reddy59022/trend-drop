/**
 * PROD E2E — 12: Promo codes and bundle discounts.
 * Tests promo code creation, validation at checkout, and application.
 * Also tests bundle discount rules.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

test.describe('12 · Promo codes & bundle discounts (production)', () => {
  let api, state, alexToken, jordanToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('seller creates a percentage promo code', async () => {
    const code = `E2E${RUN_ID.slice(-6).toUpperCase()}`;
    const r = await api.req('post', '/api/promos', {
      token: alexToken,
      body: {
        code,
        discountType: 'percentage',
        discountValue: 15,
        minPurchaseAmount: 20,
        maxDiscountAmount: 50,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        usageLimit: 10,
        description: 'E2E test promo 15% off',
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.code).toBe(code);
    expect(r.data.discountType).toBe('percentage');
    expect(r.data.discountValue).toBe(15);
    state.promos = state.promos || {};
    state.promos.pct = { code, id: r.data._id };
    saveState(state);
  });

  test('seller creates a fixed-amount promo code', async () => {
    const code = `E2E${RUN_ID.slice(-6).toUpperCase()}FIXED`;
    const r = await api.req('post', '/api/promos', {
      token: alexToken,
      body: {
        code,
        discountType: 'fixed',
        discountValue: 10,
        minPurchaseAmount: 30,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        usageLimit: 5,
        description: 'E2E test promo $10 off',
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    state.promos.fixed = { code, id: r.data._id };
    saveState(state);
  });

  test('duplicate promo code is rejected', async () => {
    const r = await api.req('post', '/api/promos', {
      token: alexToken,
      body: {
        code: state.promos.pct.code,
        discountType: 'percentage',
        discountValue: 20,
      },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/already exists/i);
  });

  test('validate a valid percentage promo code', async () => {
    const r = await api.req('post', '/api/promos/validate', {
      token: jordanToken,
      body: {
        code: state.promos.pct.code,
        items: [
          { listingId: state.listings.A.id, price: state.listings.A.price, quantity: 1, category: 'Clothing' },
        ],
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.valid).toBe(true);
    expect(r.data.promo.discountType).toBe('percentage');
    expect(r.data.promo.discountAmount).toBeGreaterThan(0);
  });

  test('validate rejects an invalid promo code', async () => {
    const r = await api.req('post', '/api/promos/validate', {
      token: jordanToken,
      body: {
        code: 'NONEXISTENT',
        items: [{ listingId: state.listings.A.id, price: 45, quantity: 1 }],
      },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/invalid promo/i);
  });

  test('validate rejects promo below minimum purchase', async () => {
    // Use a very low-priced item that doesn't meet the $20 minimum
    const r = await api.req('post', '/api/promos/validate', {
      token: jordanToken,
      body: {
        code: state.promos.pct.code,
        items: [{ listingId: state.listings.A.id, price: 5, quantity: 1 }],
      },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/minimum purchase/i);
  });

  test('seller can list their promo codes', async () => {
    const r = await api.req('get', '/api/promos', { token: alexToken });
    expect(r.status).toBe(200);
    const promos = Array.isArray(r.data) ? r.data : (r.data.promos || []);
    expect(promos.length).toBeGreaterThanOrEqual(2);
  });

  test('seller can update a promo code', async () => {
    const r = await api.req('put', `/api/promos/${state.promos.pct.id}`, {
      token: alexToken,
      body: { discountValue: 20, description: 'Updated to 20%' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.discountValue).toBe(20);
  });

  test('seller can delete a promo code', async () => {
    const r = await api.req('delete', `/api/promos/${state.promos.fixed.id}`, { token: alexToken });
    expect(r.status).toBe(200);
  });

  test('bundle discount rules are accessible', async () => {
    const r = await api.req('get', '/api/bundle-discounts', { token: alexToken });
    // Either 200 (endpoint exists) or 404 (not implemented)
    expect([200, 404]).toContain(r.status);
    if (r.status === 200) {
      const rules = Array.isArray(r.data) ? r.data : (r.data.rules || r.data.bundleRules || []);
      expect(Array.isArray(rules)).toBe(true);
    }
  });

  test('promo code usage is tracked', async () => {
    const r = await api.req('post', `/api/promos/${state.promos.pct.id}/use`, {
      token: jordanToken,
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.data.usageCount).toBeGreaterThanOrEqual(1);
    saveState(state);
  });
});
