/**
 * PROD E2E — 23: Unified per-person messaging (THE duplicate-rows regression).
 *
 * The /messages page previously showed MULTIPLE rows for the same person
 * (one per listing). After the fix:
 *   GET /api/messages/conversations            → grouped: exactly ONE row per person
 *   GET /api/messages/conversation/:userId     → unified thread: ALL messages across
 *                                                ALL listings + every offer, merged
 *                                                chronologically with listing context
 *   POST /api/messages                         → send (find-or-creates per-listing thread)
 *
 * Verified in BOTH in-memory and prod targets (accounts: alex=seller, jordan=buyer).
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

test.describe('23 · Unified per-person messaging (no duplicate rows)', () => {
  let api, state, alexToken, jordanToken;
  let alexId, jordanId;
  let listingAId, listingBId;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');

    const meAlex = await api.me('alex');
    const meJordan = await api.me('jordan');
    alexId = meAlex.user ? meAlex.user._id : meAlex._id;
    jordanId = meJordan.user ? meJordan.user._id : meJordan._id;

    // Two listings from the SAME seller (alex) — the scenario that used to
    // duplicate the seller into two rows on /messages.
    const mk = async (title) => {
      const r = await api.req('post', '/api/listings', {
        token: alexToken,
        body: {
          title, description: `Messaging test listing ${RUN_ID}`,
          price: 40, originalPrice: 80, category: 'Clothing', brand: 'E2EBrand',
          size: 'M', condition: 'New with tags', color: 'Blue', quantity: 1,
          domesticShipping: 'flat', shippingCost: 5.0, shipsFrom: 'US',
        },
      });
      expect(r.status, JSON.stringify(r.data)).toBe(201);
      const listing = r.data.listing || r.data;
      return listing._id;
    };
    listingAId = await mk(`PROD-E2E ${RUN_ID} msg-A`);
    listingBId = await mk(`PROD-E2E ${RUN_ID} msg-B`);
    state.listings.msgA = { id: listingAId, price: 40, seller: 'alex' };
    state.listings.msgB = { id: listingBId, price: 40, seller: 'alex' };
    saveState(state);
  });

  test.afterAll(async () => { await api.dispose(); });

  test('buyer sends messages to the same seller about TWO different listings', async () => {
    const r1 = await api.req('post', '/api/messages', {
      token: jordanToken,
      body: { listingId: listingAId, sellerId: alexId, text: `E2E ${RUN_ID} msg-A: is this available?` },
    });
    expect(r1.status, JSON.stringify(r1.data)).toBe(201);
    expect(r1.data.messages).toHaveLength(1);

    const r2 = await api.req('post', '/api/messages', {
      token: jordanToken,
      body: { listingId: listingBId, sellerId: alexId, text: `E2E ${RUN_ID} msg-B: also interested in this one` },
    });
    expect(r2.status, JSON.stringify(r2.data)).toBe(201);
  });

  test('GET /conversations shows exactly ONE row per person (not one per listing)', async () => {
    const r = await api.req('get', '/api/messages/conversations', { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);

    const rowsForAlex = r.data.filter(c => c.otherUser && c.otherUser._id === alexId);
    // THE core regression: the same person must NEVER appear twice
    expect(rowsForAlex, 'duplicate rows for the same person!').toHaveLength(1);

    const row = rowsForAlex[0];
    expect(row.listingCount).toBeGreaterThanOrEqual(2);
    expect(row.messageCount).toBeGreaterThanOrEqual(2);
    // Latest message wins the row preview
    expect(row.lastMessage.text).toContain('msg-B');
  });

  test('grouped row merges unread counts across listings for the seller', async () => {
    const r = await api.req('get', '/api/messages/conversations', { token: alexToken });
    expect(r.status).toBe(200);

    const rowsForJordan = r.data.filter(c => c.otherUser && c.otherUser._id === jordanId);
    expect(rowsForJordan, 'duplicate rows for the same person!').toHaveLength(1);
    // Buyer messaged on two listings; seller hasn't read either
    expect(rowsForJordan[0].unreadCount).toBeGreaterThanOrEqual(2);
  });

  test('unified thread GET /conversation/:userId merges ALL listings chronologically', async () => {
    const r = await api.req('get', `/api/messages/conversation/${alexId}`, { token: jordanToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);

    expect(r.data).toHaveProperty('messages');
    expect(r.data).toHaveProperty('listings');
    expect(r.data).toHaveProperty('offers');

    // Messages from BOTH listings are present
    const texts = r.data.messages.map(m => m.text);
    expect(texts.some(t => t.includes('msg-A'))).toBe(true);
    expect(texts.some(t => t.includes('msg-B'))).toBe(true);
    expect(r.data.listings.length).toBeGreaterThanOrEqual(2);

    // Every message carries its listing context (so UI can label "Re: item")
    for (const m of r.data.messages) {
      expect(m.listing, 'message missing listing context').toBeTruthy();
      expect(m.listing._id).toBeTruthy();
    }

    // Chronological order (oldest first)
    for (let i = 1; i < r.data.messages.length; i++) {
      expect(new Date(r.data.messages[i].createdAt) >= new Date(r.data.messages[i - 1].createdAt)).toBe(true);
    }
  });

  test('seller reply appears in the unified thread and clears unread', async () => {
    // Seller replies on listingA's thread
    const reply = await api.req('post', '/api/messages', {
      token: alexToken,
      body: { listingId: listingAId, sellerId: jordanId, text: `E2E ${RUN_ID} seller reply: yes available` },
    });
    expect(reply.status, JSON.stringify(reply.data)).toBe(200);

    // Buyer's list shows unread from the reply (across-listing merge)
    const listRes = await api.req('get', '/api/messages/conversations', { token: jordanToken });
    const row = listRes.data.filter(c => c.otherUser && c.otherUser._id === alexId);
    expect(row).toHaveLength(1);
    expect(row[0].unreadCount).toBeGreaterThanOrEqual(1);

    // Buyer opens the unified thread → everything marked read
    const thread = await api.req('get', `/api/messages/conversation/${alexId}`, { token: jordanToken });
    expect(thread.status).toBe(200);
    const replyText = thread.data.messages.map(m => m.text).find(t => t.includes('seller reply'));
    expect(replyText, 'seller reply missing from unified thread').toBeTruthy();

    const listRes2 = await api.req('get', '/api/messages/conversations', { token: jordanToken });
    const row2 = listRes2.data.filter(c => c.otherUser && c.otherUser._id === alexId);
    expect(row2).toHaveLength(1);
    expect(row2[0].unreadCount).toBe(0);
  });

  test('offer made on one listing appears in the unified thread with listing context', async () => {
    const offer = await api.req('post', '/api/offers', {
      token: jordanToken,
      body: { listingId: listingBId, amount: 30, message: `E2E ${RUN_ID} unified-thread offer` },
    });
    expect(offer.status, JSON.stringify(offer.data)).toBe(201);
    state.offers = state.offers || {};
    state.offers.msgUnified = { id: offer.data._id, amount: 30 };
    saveState(state);

    const thread = await api.req('get', `/api/messages/conversation/${alexId}`, { token: jordanToken });
    expect(thread.status).toBe(200);
    expect(Array.isArray(thread.data.offers)).toBe(true);
    const matching = thread.data.offers.find(o => o._id === offer.data._id);
    expect(matching, 'offer missing from unified thread').toBeTruthy();
    expect(matching.listing, 'offer missing listing context').toBeTruthy();
    expect(matching.listing.title).toContain('msg-B');
  });

  test('conversations with DIFFERENT sellers stay separate rows (no over-merging)', async () => {
    // seller2 is the third seeded account (in-memory only)
    const r = await api.req('post', '/api/auth/login', {
      body: { email: 'e2e-seller2@trenddrop.test', password: 'E2ePass123!' },
    });
    if (r.status !== 200) {
      test.info().annotations.push({ type: 'info', description: 'seller2 not available — skipping over-merge check' });
      return;
    }
    const seller2Token = r.data.token;
    const meS2 = await api.req('get', '/api/users/me', { token: seller2Token });
    const seller2Id = meS2.data.user ? meS2.data.user._id : meS2.data._id;

    // seller2 creates a listing, buyer messages seller2 about it
    const lr = await api.req('post', '/api/listings', {
      token: seller2Token,
      body: {
        title: `PROD-E2E ${RUN_ID} msg-S2`, description: `third-party listing ${RUN_ID}`,
        price: 25, category: 'Clothing', brand: 'E2EBrand', size: 'S',
        condition: 'Good', color: 'Red', quantity: 1,
        domesticShipping: 'flat', shippingCost: 4.0, shipsFrom: 'US',
      },
    });
    if (lr.status !== 201) return;
    const seller2ListingId = (lr.data.listing || lr.data)._id;
    const mr = await api.req('post', '/api/messages', {
      token: jordanToken,
      body: { listingId: seller2ListingId, sellerId: seller2Id, text: `E2E ${RUN_ID} msg-S2: hey` },
    });
    expect(mr.status).toBe(201);

    const list = await api.req('get', '/api/messages/conversations', { token: jordanToken });
    const alexRows = list.data.filter(c => c.otherUser && c.otherUser._id === alexId);
    const s2Rows = list.data.filter(c => c.otherUser && c.otherUser._id === seller2Id);
    expect(alexRows).toHaveLength(1);
    expect(s2Rows).toHaveLength(1);
  });

  test('legacy per-listing endpoint still works (backwards compatible)', async () => {
    const r = await api.req('get', `/api/messages/conversation/${alexId}/${listingAId}`, { token: jordanToken });
    expect(r.status).toBe(200);
    expect(r.data.messages.length).toBeGreaterThanOrEqual(1);
    expect(r.data.listing.title).toContain('msg-A');
  });

  test('unified thread requires authentication', async () => {
    const r = await api.req('get', `/api/messages/conversation/${alexId}`);
    expect(r.status).toBe(401);
  });
});
