/**
 * PROD E2E — 01: health, auth (both seeded sellers), account sanity.
 * Real production database: verifies the seeded accounts exist with seller profiles.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, ACCOUNTS, expect } = require('./helpers');

test.describe('01 · Health & Auth (production)', () => {
  let api;

  test.beforeAll(async () => { api = await makeApi(); });
  test.afterAll(async () => { await api.dispose(); });

  test('health endpoints are live', async () => {
    const health = await api.req('get', '/health');
    expect(health.status).toBe(200);
    expect(health.data?.status).toBe('ok');

    const mongo = await api.req('get', '/health/mongo');
    expect(mongo.status).toBe(200);
  });

  test('Stripe is configured in TEST mode on production', async () => {
    const r = await api.req('get', '/api/payments/status');
    expect(r.status).toBe(200);
    expect(r.data?.stripe?.stripeInitialized).toBe(true);
    expect(r.data?.stripe?.publishableKeyConfigured).toBe(true);
    expect(r.data?.stripe?.secretKeyConfigured).toBe(true);

    const pk = await api.req('get', '/api/payments/publishable-key');
    expect(pk.status).toBe(200);
    expect(String(pk.data?.publishableKey).startsWith('pk_test_'), 'production must run Stripe TEST keys').toBe(true);
  });

  test('both seeded sellers can log in (multi-seller setup)', async () => {
    const state = loadState();
    for (const key of Object.keys(ACCOUNTS)) {
      const token = await api.login(key);
      expect(token.length > 20).toBe(true);
      const me = await api.me(key);
      // Persist user ids for cross-spec assertions
      state.users[key] = { id: me._id || me.user?._id, name: me.name || me.user?.name };
      expect(state.users[key].id, `${key} must resolve to a user id`).toBeTruthy();
 expect(state.users[key].name).toBeTruthy();
    }
    // The two sellers must be DISTINCT users (multi-seller coverage)
    expect(state.users.alex.id).not.toBe(state.users.jordan.id);
    saveState(state);
  });

  test('GET /api/users/me works (regression: previously 500 via /:id CastError)', async () => {
    const token = await api.login('alex');
    const r = await api.req('get', '/api/users/me', { token });
    expect(r.status).toBe(200);
    expect(r.status, 'must not be 500').not.toBe(500);
  });

  test('unauthenticated API access is rejected', async () => {
    const r = await api.req('get', '/api/cart');
    expect([401, 403]).toContain(r.status);
  });
});
