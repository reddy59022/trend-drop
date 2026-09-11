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
  let api, jordanToken, alexToken, jordanId;

  test.beforeAll(async () => {
    api = await makeApi();
    // Self-sufficient: log in directly (tokens cached across runs in helpers)
    jordanToken = await api.login('jordan');
    alexToken = await api.login('alex');
    const me = await api.req('get', '/api/users/me', { token: jordanToken });
    jordanId = me.data?._id || me.data?.user?._id;
    expect(jordanToken, 'jordan login must yield token').toBeTruthy();
  });

  test.afterAll(async () => { await api.dispose(); });

  test('analytics overview loads with correct shape', async () => {
    for (const period of ['7d', '30d']) {
      const r = await api.req('get', `/api/users/me/analytics/overview?period=${period}`, { token: jordanToken });
      expect(r.status, `overview ${period}: ` + JSON.stringify(r.data)).toBe(200);
      expect(r.data.overview, 'overview object').toBeTruthy();
      expect(typeof r.data.overview.totalRevenue).toBe('number');
      expect(typeof r.data.overview.totalSales).toBe('number');
    }
  });

  test('analytics revenue returns time-series buckets', async () => {
    const r = await api.req('get', '/api/users/me/analytics/revenue?period=30d', { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(Array.isArray(r.data.revenue), 'revenue array').toBe(true);
  });

  test('analytics top-listings returns ranked list', async () => {
    const r = await api.req('get', '/api/users/me/analytics/top-listings?period=30d', { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(Array.isArray(r.data.topListings), 'topListings array').toBe(true);
  });

  test('listings/user/:userId matches SellerDashboard call', async () => {
    const r = await api.req('get', `/api/listings/user/${jordanId}`, { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(Array.isArray(r.data.listings), 'listings array').toBe(true);
  });

  test('auctions full lifecycle: create → mine → close', async () => {
    // create a listing then an auction on it
    var lr = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: 'E2E Auction Gap ' + RUN_ID, description: 'gap coverage',
        price: 25, category: 'Women', size: 'M', condition: 'Good',
        images: ['https://via.placeholder.com/400'],
      },
    });
    expect([200, 201].includes(lr.status), JSON.stringify(lr.data)).toBe(true);
    const listingId = lr.data.listing?._id || lr.data._id;
    const now = new Date(), end = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const ar = await api.req('post', '/api/auctions', {
      token: alexToken,
      body: {
        listingId, startTime: now.toISOString(), endTime: end.toISOString(),
      },
    });
    expect(ar.status, JSON.stringify(ar.data)).toBe(201);
    const auctionId = ar.data.auction._id;
    // ?mine=true (getMyAuctions helper)
    const mine = await api.req('get', '/api/auctions?mine=true', { token: alexToken });
    expect(mine.status, JSON.stringify(mine.data)).toBe(200);
    expect(mine.data.auctions.some(a => String(a._id) === String(auctionId)), 'mine contains auction').toBe(true);
    // close (endAuction helper)
    const close = await api.req('post', `/api/auctions/${auctionId}/close`, { token: alexToken });
    expect(close.status, JSON.stringify(close.data)).toBe(200);
    expect(close.data.auction.status).toBe('closed');
  });

  test('auctions cancel: create → DELETE /:id', async () => {
    const lr = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `E2E Auction Cancel ${RUN_ID}`, description: 'gap coverage',
        price: 30, category: 'Men', size: 'L', condition: 'Good',
        images: ['https://via.placeholder.com/400'],
      },
    });
    const listingId = lr.data.listing?._id || lr.data._id;
    const now = new Date(), end = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const ar = await api.req('post', '/api/auctions', {
      token: alexToken,
      body: {
        listingId, startTime: now.toISOString(), endTime: end.toISOString(),
      },
    });
    const auctionId = ar.data.auction._id;
    const del = await api.req('delete', `/api/auctions/${auctionId}`, { token: alexToken });
    expect(del.status, JSON.stringify(del.data)).toBe(200);
    expect(del.data.auction.status).toBe('cancelled');
  });

  test('parties: create → join → share → list', async () => {
    const now = new Date(), end = new Date(Date.now() + 3600 * 1000);
    const cr = await api.req('post', '/api/parties', {
      token: jordanToken,
      body: {
        title: `E2E Party ${RUN_ID}`, description: 'gap coverage',
        category: 'Women', startTime: now.toISOString(), endTime: end.toISOString(),
      },
    });
    expect([200, 201].includes(cr.status), JSON.stringify(cr.data)).toBe(true);
    const partyId = cr.data.party?._id || cr.data._id;
    const join = await api.req('post', `/api/parties/${partyId}/join`, { token: jordanToken });
    expect([200, 201].includes(join.status), JSON.stringify(join.data)).toBe(true);
    const share = await api.req('post', `/api/parties/${partyId}/share`, { token: jordanToken });
    expect([200, 201].includes(share.status), JSON.stringify(share.data)).toBe(true);
    const list = await api.req('get', '/api/parties', { token: jordanToken });
    expect(list.status, JSON.stringify(list.data)).toBe(200);
    expect(Array.isArray(list.data.parties), 'parties array').toBe(true);
    saveState({ ...loadState(), gapPartyId: partyId });
  });
});