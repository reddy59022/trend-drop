/**
 * PROD E2E — 15: Seller tier progression & verification.
 * Tiers are derived from authoritative platform records (settled
 * transactions, ratings, realized returns). A seller must never be able to
 * grant themselves a tier by posting numbers to the recalculation endpoint.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, expect } = require('./helpers');

const VALID_TIERS = ['bronze', 'silver', 'gold', 'platinum'];

test.describe('15 · Seller tiers & verification (production)', () => {
  let api, state, alexToken, jordanToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('seller badge auto-created on first access (Alex)', async () => {
    const r = await api.req('get', '/api/seller-badges/me', { token: alexToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.badge).toBeTruthy();
    expect(VALID_TIERS).toContain(r.data.badge.tier);
  });

  test('seller badge auto-created on first access (Jordan)', async () => {
    const r = await api.req('get', '/api/seller-badges/me', { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.badge).toBeTruthy();
    expect(VALID_TIERS).toContain(r.data.badge.tier);
  });

  test('public badge endpoint returns seller badge', async () => {
    const r = await api.req('get', `/api/seller-badges/${state.users.alex.id}`);
    expect(r.status).toBe(200);
    expect(r.data.badge).toBeTruthy();
    expect(VALID_TIERS).toContain(r.data.badge.tier);
  });

  test('client-supplied stats do not change the seller tier', async () => {
    const before = await api.req('get', '/api/seller-badges/me', { token: alexToken });
    expect(before.status, JSON.stringify(before.data)).toBe(200);

    const inflated = await api.req('put', '/api/seller-badges/update-stats', {
      token: alexToken,
      body: { salesCount: 5000, avgRating: 5, responseRate: 1, returnRate: 0 },
    });
    expect(inflated.status, JSON.stringify(inflated.data)).toBe(200);
    expect(inflated.data.badge.tier).toBe(before.data.badge.tier);
    expect(inflated.data.badge.salesCount).toBe(before.data.badge.salesCount);
  });

  test('recalculation reports stats derived from real records', async () => {
    const first = await api.req('put', '/api/seller-badges/update-stats', {
      token: alexToken,
      body: {},
    });
    expect(first.status).toBe(200);

    const second = await api.req('put', '/api/seller-badges/update-stats', {
      token: alexToken,
      body: { salesCount: 1, avgRating: 0, responseRate: 0, returnRate: 1 },
    });
    expect(second.status).toBe(200);
    expect(second.data.badge.salesCount).toBe(first.data.badge.salesCount);
    expect(second.data.badge.tier).toBe(first.data.badge.tier);
    expect(VALID_TIERS).toContain(second.data.badge.tier);
    expect(second.data.badge.salesCount).toBeGreaterThanOrEqual(0);

    state.badges = state.badges || {};
    state.badges.alexTier = second.data.badge.tier;
    saveState(state);
  });

  test('seller verification can be requested without self-approving', async () => {
    const r = await api.req('put', '/api/seller-badges/verify', {
      token: alexToken,
      body: {},
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.badge.isVerified).toBe(false);
    expect(r.data.badge.verificationRequested).toBe(true);
    expect(r.data.badge.verifiedAt).toBeFalsy();
    expect(r.data.badge.benefits.reducedFees).toBe(false);
    expect(r.data.badge.benefits.prioritySupport).toBe(false);
  });

  test('pending verification status is reflected in public badge', async () => {
    const r = await api.req('get', `/api/seller-badges/${state.users.alex.id}`);
    expect(r.status).toBe(200);
    expect(r.data.badge.isVerified).toBe(false);
    expect(r.data.badge.verificationRequested).toBe(true);
  });
});
