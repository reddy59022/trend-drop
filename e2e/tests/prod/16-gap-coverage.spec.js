/**
 * PROD E2E — 16: Backend↔Frontend gap coverage.
 * Covers every endpoint added/fixed by the gap audit:
 *  - SellerAnalytics: GET /api/users/me/analytics/{overview,revenue,top-listings}?period=
 *  - Auctions: GET ?mine=true, POST /:id/close, DELETE /:id (cancel)
 *  - Auth: DELETE /api/auth/account (verified last so it doesn't break other suites)
 *  - Parties: GET/POST /api/parties, POST /:id/join, POST /:id/share
 *  - Listings: GET /api/listings/user/:userId
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

test.describe('16 · BE↔FE gap coverage (production)', () => {
  let api, state, jordanToken, alexToken, jordanId;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    jordanToken = state.jordan?.token;
    alexToken = state.alex?.token;
    jordanId = state.jordan?.userId;
    expect(jordanToken, 'missing jordan token — run specs 01–08 first').toBeTruthy();
  });

  test('analytics overview loads with correct shape', async () => {
    const t = api.withToken(jordanToken);
    for (const period of ['7d', '30d']) {
      const r = await t.req('get', `/api/users/me/analytics/overview?period=${period}`);
      expect(r.status, `overview ${period}: ` + JSON.stringify(r.data)).toBe(200);
      expect(r.data.overview, 'overview object').toBeTruthy();
      expect(typeof r.data.overview.totalRevenue).toBe('number');
      expect(typeof r.data.overview.totalSales).toBe('number');
    }
  });

  test('analytics revenue returns time-series buckets', async () => {
    const t = api.withToken(jordanToken);
    const r = await t.req('get', '/api/users/me/analytics/revenue?period=30d');
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(Array.isArray(r.data.revenue), 'revenue array').toBe(true);
  });

  test('analytics top-listings returns ranked list', async () => {
    const t = api.withToken(jordanToken);
    const r = await t.req('get', '/api/users/me/analytics/top-listings?period=30d');
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(Array.isArray(r.data.topListings), 'topListings array').toBe(true);
  });

  test('listings/user/:userId matches SellerDashboard call', async () => {
    const t = api.withToken(jordanToken);
    const r = await t.req('get', `/api/listings/user/${jordanId}`);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(Array.isArray(r.data.listings), 'listings array').toBe(true);
  });

  test('auctions full lifecycle: create → mine → close', async () => {
    const seller = api.withToken(alexToken || jordanToken);
    // create a listing then an auction on it
    const lr = await seller.req('post', '/api/listings', {
      title: `E2E Auction Gap ${RUN_ID}`, description: 'gap coverage',
      price: 25, category: 'Women', size: 'M', condition: 'Like New',
      images: ['https://via.placeholder.com/400'],
    });
    expect([200, 201].includes(lr.status), JSON.stringify(lr.data)).toBe(true);
    const listingId = lr.data.listing?._id || lr.data._id;
    const now = new Date(), end = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const ar = await seller.req('post', '/api/auctions', {
      listingId, startTime: now.toISOString(), endTime: end.toISOString(),
    });
    expect(ar.status, JSON.stringify(ar.data)).toBe(201);
    const auctionId = ar.data.auction._id;
    // ?mine=true (getMyAuctions helper)
    const mine = await seller.req('get', '/api/auctions?mine=true');
    expect(mine.status, JSON.stringify(mine.data)).toBe(200);
    expect(mine.data.auctions.some(a => String(a._id) === String(auctionId)), 'mine contains auction').toBe(true);
    // close (endAuction helper)
    const close = await seller.req('post', `/api/auctions/${auctionId}/close`);
    expect(close.status, JSON.stringify(close.data)).toBe(200);
    expect(close.data.auction.status).toBe('closed');
  });

  test('auctions cancel: create → DELETE /:id', async () => {
    const seller = api.withToken(alexToken || jordanToken);
    const lr = await seller.req('post', '/api/listings', {
      title: `E2E Auction Cancel ${RUN_ID}`, description: 'gap coverage',
      price: 30, category: 'Men', size: 'L', condition: 'Good',
      images: ['https://via.placeholder.com/400'],
    });
    const listingId = lr.data.listing?._id || lr.data._id;
    const now = new Date(), end = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const ar = await seller.req('post', '/api/auctions', {
      listingId, startTime: now.toISOString(), endTime: end.toISOString(),
    });
    const auctionId = ar.data.auction._id;
    const del = await seller.req('delete', `/api/auctions/${auctionId}`);
    expect(del.status, JSON.stringify(del.data)).toBe(200);
    expect(del.data.auction.status).toBe('cancelled');
  });

  test('parties: create → join → share → list', async () => {
    const t = api.withToken(jordanToken);
    const now = new Date(), end = new Date(Date.now() + 3600 * 1000);
    const cr = await t.req('post', '/api/parties', {
      title: `E2E Party ${RUN_ID}`, description: 'gap coverage',
      category: 'Women', startTime: now.toISOString(), endTime: end.toISOString(),
    });
    expect([200, 201].includes(cr.status), JSON.stringify(cr.data)).toBe(true);
    const partyId = cr.data.party?._id || cr.data._id;
    const join = await t.req('post', `/api/parties/${partyId}/join`);
    expect([200, 201].includes(join.status), JSON.stringify(join.data)).toBe(true);
    const share = await t.req('post', `/api/parties/${partyId}/share`);
    expect([200, 201].includes(share.status), JSON.stringify(share.data)).toBe(true);
    const list = await t.req('get', '/api/parties');
    expect(list.status, JSON.stringify(list.data)).toBe(200);
    expect(Array.isArray(list.data.parties), 'parties array').toBe(true);
    saveState({ ...loadState(), gapPartyId: partyId });
  });
});
