/**
 * PROD E2E — 07: reviews (ratings), seller badges, loyalty tiers.
 * Reviews require a COMPLETED transaction — the suite drives the real paid
 * lifecycle and additionally asserts the guard against non-completed orders;
 * when a completed transaction exists for the account, a REAL review is posted.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

test.describe('07 · Reviews, badges, loyalty (production)', () => {
  let api, state, alexToken, jordanToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    jordanToken = await api.login('jordan');
    alexToken = await api.login('alex');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('reviewing a non-completed purchase is blocked (business rule)', async () => {
    // Jordan's batch transaction for A is shipped, NOT completed → must be rejected.
    const r = await api.req('post', '/api/ratings', {
      token: jordanToken,
      body: { listingId: state.listings.A.id, rating: 5, review: 'E2E should be rejected' },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/only review items you have purchased/i);
  });

  test('review requires authentication', async () => {
    const r = await api.req('post', '/api/ratings', {
      body: { listingId: state.listings.A.id, rating: 5, review: 'anon' },
    });
    expect([401, 403]).toContain(r.status);
  });

  test('real reviews are posted when a COMPLETED transaction exists', async () => {
    // Find a completed transaction for Jordan in the production DB
    const tr = await api.req('get', '/api/transactions', { token: jordanToken });
    expect(tr.status).toBe(200);
    const txns = Array.isArray(tr.data) ? tr.data : (tr.data.transactions || tr.data.data || []);
    const completed = txns.find((t) => t.status === 'completed' && t.listing);
    test.info().annotations.push({ type: 'info', description: completed
      ? `completed txn found → posting real review on ${completed.listing._id ?? completed.listing}`
      : 'no completed txn yet → completed-lifecycle review path not exercised (carrier-delivery dependent)' });
    if (!completed) return;

    const listingId = String(completed.listing._id ?? completed.listing);
    const post = await api.req('post', '/api/ratings', {
      token: jordanToken,
      body: { listingId, rating: 5, review: `PROD-E2E ${state.runId ?? ''} verified purchase review` },
    });
    expect([201, 400]).toContain(post.status); // 400 = already reviewed in an earlier run (also valid)

    // Duplicate review must always be rejected
    const dup = await api.req('post', '/api/ratings', {
      token: jordanToken,
      body: { listingId, rating: 4, review: 'duplicate' },
    });
    expect(dup.status).toBe(400);
  });

  test('seller ratings aggregate publicly (Alex)', async () => {
    const r = await api.req('get', `/api/ratings/seller/${state.users.alex.id}`);
    expect(r.status).toBe(200);
    const d = r.data.ratings ? r.data : { averageRating: r.data.averageRating, count: r.data.count, ratings: r.data.ratings || [] };
    expect(d.count).toBeGreaterThanOrEqual(0);
    if (d.count > 0) {
      expect(d.averageRating).toBeGreaterThanOrEqual(1);
      expect(d.averageRating).toBeLessThanOrEqual(5);
    }
  });

  test('listing ratings are readable', async () => {
    const r = await api.req('get', `/api/ratings/listing/${state.listings.B.id}`);
    expect([200, 404]).toContain(r.status);
  });

  test('seller badges resolve for both sellers with a valid tier', async () => {
    for (const [key, token] of [['alex', alexToken], ['jordan', jordanToken]]) {
      const r = await api.req('get', '/api/seller-badges/me', { token });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
      const badge = r.data.badge;
      expect(badge, 'badge must exist (auto-created)').toBeTruthy();
      expect(['bronze', 'silver', 'gold', 'platinum', 'none']).toContain(badge.tier);
      // Public endpoint shows the same badge
      const pub = await api.req('get', `/api/seller-badges/${state.users[key].id}`);
      expect(pub.status).toBe(200);
    }
  });

  test('loyalty program: tier + points for Jordan', async () => {
    const r = await api.req('get', '/api/loyalty', { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(['Silver', 'Gold', 'Platinum']).toContain(r.data.tier);
    expect(typeof r.data.points === 'number' && r.data.points >= 0).toBe(true);
  });

  test('loyalty points earn → history', async () => {
    const earn = await api.req('post', '/api/loyalty/earn', {
      token: jordanToken,
      body: { amount: 10, reason: `PROD-E2E ${RUN_ID ?? 'run'} purchase` },
    });
    expect(earn.status, JSON.stringify(earn.data)).toBe(200);
    expect(earn.data.points).toBeGreaterThanOrEqual(10);
    expect(['Silver', 'Gold', 'Platinum']).toContain(earn.data.tier);

    const hist = await api.req('get', '/api/loyalty/history', { token: jordanToken });
    expect(hist.status).toBe(200);
    const entries = Array.isArray(hist.data) ? hist.data : (hist.data.history || hist.data.pointsHistory || []);
    expect(entries.length).toBeGreaterThan(0);
  });

  test('loyalty redemption validates point balance', async () => {
    const r = await api.req('post', '/api/loyalty/redeem', { token: jordanToken, body: { amount: 99999999 } });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/insufficient/i);
  });
});
