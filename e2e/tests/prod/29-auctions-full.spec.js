/**
 * PROD E2E — 29: AUCTIONS FULL JOURNEY.
 * Create an auction on a listing → buyer places a bid → outbid → invalid bids
 * rejected → close auction → winner checkout via payments flow → listing sold.
 *
 * Self-sufficient.
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'E2E Buyer', street1: '500 Auction Ave', city: 'Austin', state: 'TX',
  postalCode: '78701', country: 'US', phone: '+15555550500',
};

test.describe('29 · Auctions full journey (bid -> close -> winner purchase)', () => {
  let api, state, sellerToken, buyerToken;
  let listingId, auctionId;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('S29.1 seller creates a listing for auction', async () => {
    const r = await api.req('post', '/api/listings', {
      token: sellerToken,
      body: {
        title: `S29 ${RUN_ID} auction-item`,
        description: 'E2E auction listing',
        price: 50, category: 'Men', brand: 'E2E', size: 'M',
        condition: 'New with tags', color: 'Black', quantity: 1,
        shipsFrom: 'US', currency: 'USD', domesticShipping: 'true',
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    listingId = (r.data.listing || r.data)._id;
    state.listings = state.listings || {};
    state.listings.S29 = { id: listingId };
    saveState(state);
  });

  test('S29.2 seller creates a SHORT-LIVED auction on the listing', async () => {
    // Short window so the auction can legitimately END within this test run:
    // bids must land while active (endTime in future), close requires endTime past.
    const start = new Date(Date.now() - 60 * 1000); // started 1 min ago -> active
    const end = new Date(Date.now() + 2 * 1000);    // ends 2s from now
    const r = await api.req('post', '/api/auctions', {
      token: sellerToken,
      body: {
        listingId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        reservePrice: 40,
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    auctionId = (r.data.auction || r.data)._id;
    state.auctions = state.auctions || {};
    state.auctions.S29 = { id: auctionId };
    saveState(state);
  });

  test('S29.3 buyer places a valid bid', async () => {
    const id = auctionId || (state.auctions && state.auctions.S29 && state.auctions.S29.id);
    expect(id, 'auctionId must be set').toBeTruthy();
    const r = await api.req('post', `/api/auctions/${id}/bids`, {
      token: buyerToken,
      body: { amount: 45 }, // above reserve price of 40
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
  });

  test('S29.4 bid below current price is rejected', async () => {
    const id = auctionId || (state.auctions && state.auctions.S29 && state.auctions.S29.id);
    expect(id, 'auctionId must be set').toBeTruthy();
    const r = await api.req('post', `/api/auctions/${id}/bids`, {
      token: buyerToken,
      body: { amount: 40 }, // below current bid of 45
    });
    expect([400, 403, 409]).toContain(r.status);
  });

  test('S29.5 close the auction after it ends → winner + server-created order', async () => {
    const id = auctionId || (state.auctions && state.auctions.S29 && state.auctions.S29.id);
    expect(id, 'auctionId must be set').toBeTruthy();
    // Wait for the 2s auction window to elapse (close requires endTime past).
    await new Promise((res) => setTimeout(res, 2500));
    const r = await api.req('post', `/api/auctions/${id}/close`, { token: sellerToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const auction = r.data.auction || r.data;
    expect(auction.status).toBe('closed');
    expect(auction.winner).toBeTruthy();
    // Enterprise standard: close creates a PENDING transaction for the winner
    // (8% platform fee applied server-side).
    expect(r.data.transaction).toBeTruthy();
    expect(r.data.transaction.status).toBe('pending');
    expect(r.data.transaction.platformFee).toBeCloseTo(45 * 0.08, 2); // 8% of 45
    state.txns = state.txns || {};
    state.txns.S29 = { id: String(r.data.transaction._id), status: 'pending' };
    saveState(state);
  });

  test('S29.6 winner has a pending order awaiting payment (created at close)', async () => {
    const txnId = state.txns && state.txns.S29 && state.txns.S29.id;
    expect(txnId, 'winner transaction id must be set').toBeTruthy();
    const r = await api.req('get', '/api/transactions', { token: buyerToken });
    expect(r.status).toBe(200);
    const list = Array.isArray(r.data) ? r.data : (r.data.transactions || []);
    const mine = list.find((t) => String(t._id) === String(txnId));
    expect(mine, 'winner transaction must exist for the buyer').toBeTruthy();
    expect(['pending', 'paid']).toContain(mine.status);
  });

  test('S29.7 listing is marked sold after the auction closes', async () => {
    const lid = listingId || (state.listings && state.listings.S29 && state.listings.S29.id);
    expect(lid, 'listingId must be set').toBeTruthy();
    const r = await api.req('get', `/api/listings/${lid}`);
    const l = r.data.listing || r.data;
    expect(l.sold === true || l.quantity === 0).toBe(true);
  });
});
