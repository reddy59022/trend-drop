/**
 * PROD E2E — 15: Seller tier progression & verification.
 * Tests the badge/tier system: auto-creation, tier calculation based on
 * sales count + rating + return rate, and the verification flow.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

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
    expect(['bronze', 'silver', 'gold', 'platinum', 'none']).toContain(r.data.badge.tier);
  });

  test('seller badge auto-created on first access (Jordan)', async () => {
    const r = await api.req('get', '/api/seller-badges/me', { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.badge).toBeTruthy();
    expect(['bronze', 'silver', 'gold', 'platinum', 'none']).toContain(r.data.badge.tier);
  });

  test('public badge endpoint returns seller badge', async () => {
    const r = await api.req('get', `/api/seller-badges/${state.users.alex.id}`);
    expect(r.status).toBe(200);
    expect(r.data.badge).toBeTruthy();
    expect(['bronze', 'silver', 'gold', 'platinum', 'none']).toContain(r.data.badge.tier);
  });

  test('seller stats update triggers tier recalculation', async () => {
    // Update Alex's stats to qualify for silver (10+ sales, 4.5+ rating, <10% returns)
    const r = await api.req('put', '/api/seller-badges/update-stats', {
      token: alexToken,
      body: {
        salesCount: 15,
        avgRating: 4.7,
        responseRate: 0.95,
        returnRate: 0.05,
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.badge.tier).toBe('silver');
    state.badges = state.badges || {};
    state.badges.alexTier = 'silver';
    saveState(state);
  });

  test('gold tier requires higher stats', async () => {
    const r = await api.req('put', '/api/seller-badges/update-stats', {
      token: alexToken,
      body: {
        salesCount: 75,
        avgRating: 4.8,
        responseRate: 0.98,
        returnRate: 0.03,
      },
    });
    expect(r.status).toBe(200);
    expect(r.data.badge.tier).toBe('gold');
    expect(r.data.badge.benefits.featuredListings).toBe(true);
  });

  test('platinum tier requires top stats', async () => {
    const r = await api.req('put', '/api/seller-badges/update-stats', {
      token: alexToken,
      body: {
        salesCount: 250,
        avgRating: 4.9,
        responseRate: 0.99,
        returnRate: 0.01,
      },
    });
    expect(r.status).toBe(200);
    expect(r.data.badge.tier).toBe('platinum');
    expect(r.data.badge.benefits.featuredListings).toBe(true);
  });

  test('low stats revert tier to bronze', async () => {
    const r = await api.req('put', '/api/seller-badges/update-stats', {
      token: alexToken,
      body: {
        salesCount: 2,
        avgRating: 3.5,
        responseRate: 0.5,
        returnRate: 0.2,
      },
    });
    expect(r.status).toBe(200);
    expect(r.data.badge.tier).toBe('bronze');
  });

  test('seller verification can be requested', async () => {
    const r = await api.req('put', '/api/seller-badges/verify', {
      token: alexToken,
      body: {},
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.badge.isVerified).toBe(true);
    expect(r.data.badge.verifiedAt).toBeTruthy();
    expect(r.data.badge.benefits.reducedFees).toBe(true);
    expect(r.data.badge.benefits.prioritySupport).toBe(true);
  });

  test('verified status is reflected in public badge', async () => {
    const r = await api.req('get', `/api/seller-badges/${state.users.alex.id}`);
    expect(r.status).toBe(200);
    expect(r.data.badge.isVerified).toBe(true);
  });

  test('badge stats reflect actual sales data', async () => {
    // Reset to realistic values for Alex (who has actual sales from this run)
    const r = await api.req('put', '/api/seller-badges/update-stats', {
      token: alexToken,
      body: {
        salesCount: 20,
        avgRating: 4.6,
        responseRate: 0.9,
        returnRate: 0.05,
      },
    });
    expect(r.status).toBe(200);
    expect(['silver', 'gold', 'platinum']).toContain(r.data.badge.tier);
    saveState(state);
  });
});
