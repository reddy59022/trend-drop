/**
 * PROD E2E — 10: Full offer lifecycle.
 * Correct API endpoints:
 *   POST /api/offers                    - create offer (flat response)
 *   PATCH /api/offers/:id/counter       - seller counters (body: {counterAmount})
 *   PATCH /api/offers/:id/accept-counter - buyer accepts counter (returns {offer})
 *   PATCH /api/offers/:id/seller-accept  - seller accepts original (returns {offer})
 *   PATCH /api/offers/:id/buyer-counter  - buyer counters back (body: {counterAmount})
 *   PATCH /api/offers/:id/seller-accept-buyer-counter - seller accepts buyer counter
 *   PATCH /api/offers/:id/decline        - seller declines
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, RUN_ID, expect } = require('./helpers');

test.describe('10 · Offer lifecycle (production)', () => {
  let api, state, alexToken, jordanToken;
  let offerListingId;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
    const r = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `PROD-E2E ${RUN_ID} offer-test`,
        description: `Offer flow test listing ${RUN_ID}`,
        price: 60, originalPrice: 100, category: 'Clothing', brand: 'E2EBrand',
        size: 'M', condition: 'New with tags', color: 'Green', quantity: 1,
        domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US',
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    const listing = r.data.listing || r.data;
    offerListingId = listing._id;
    state.listings.offerTest = { id: offerListingId, price: 60, seller: 'alex' };
    saveState(state);
  });
  test.afterAll(async () => { await api.dispose(); });

  test('buyer (Jordan) makes an offer below listing price', async () => {
    const r = await api.req('post', '/api/offers', {
      token: jordanToken,
      body: { listingId: offerListingId, amount: 45, message: 'Would you take $45?' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data._id).toBeTruthy();
    expect(r.data.amount).toBe(45);
    expect(r.data.status).toBe('pending');
    state.offers = state.offers || {};
    state.offers.offer1 = { id: r.data._id, amount: 45 };
    saveState(state);
  });

  test('buyer cannot make a second active offer on the same listing', async () => {
    const r = await api.req('post', '/api/offers', {
      token: jordanToken,
      body: { listingId: offerListingId, amount: 50, message: 'another offer' },
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/already have an active offer/i);
  });

  test('seller (Alex) counters the offer with counterAmount', async () => {
    const r = await api.req('patch', `/api/offers/${state.offers.offer1.id}/counter`, {
      token: alexToken,
      body: { counterAmount: 52, message: 'Can do $52, final' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.status).toBe('countered');
    expect(r.data.counterAmount).toBe(52);
  });

  test('buyer accepts the seller counter via accept-counter', async () => {
    const r = await api.req('patch', `/api/offers/${state.offers.offer1.id}/accept-counter`, {
      token: jordanToken, body: {},
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    // Response wraps offer in { offer: { ... } }
    expect(r.data.offer.status).toBe('accepted');
    expect(r.data.offer.acceptedPrice).toBe(52);
  });

  test('accepted offer cannot be accepted again (state guard)', async () => {
    const r = await api.req('patch', `/api/offers/${state.offers.offer1.id}/accept-counter`, {
      token: jordanToken, body: {},
    });
    expect(r.status).toBe(400);
  });

  test('seller can accept a pending offer directly (seller-accept)', async () => {
    const listing2 = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `PROD-E2E ${RUN_ID} direct-accept`,
        description: `Direct accept test ${RUN_ID}`,
        price: 70, category: 'Clothing', brand: 'E2EBrand', size: 'S',
        condition: 'New with tags', quantity: 1,
        domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US',
      },
    });
    expect(listing2.status).toBe(201);
    const l2 = listing2.data.listing || listing2.data;

    const offer = await api.req('post', '/api/offers', {
      token: jordanToken, body: { listingId: l2._id, amount: 60 },
    });
    expect(offer.status).toBe(201);
    const offerId = offer.data._id;

    const accept = await api.req('patch', `/api/offers/${offerId}/seller-accept`, {
      token: alexToken, body: {},
    });
    expect(accept.status, JSON.stringify(accept.data)).toBe(200);
    expect(accept.data.offer.status).toBe('accepted');
    expect(accept.data.offer.acceptedPrice).toBe(60);
  });

  test('counter-offer chain: buyer counters back then seller accepts', async () => {
    const listing3 = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `PROD-E2E ${RUN_ID} counter-chain`,
        description: `Counter-chain test ${RUN_ID}`,
        price: 80, category: 'Clothing', brand: 'E2EBrand', size: 'S',
        condition: 'New with tags', quantity: 1,
        domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US',
      },
    });
    expect(listing3.status).toBe(201);
    const l3 = listing3.data.listing || listing3.data;

    const offer = await api.req('post', '/api/offers', {
      token: jordanToken, body: { listingId: l3._id, amount: 60 },
    });
    expect(offer.status).toBe(201);
    const offerId = offer.data._id;

    // Seller counters $70
    const counter1 = await api.req('patch', `/api/offers/${offerId}/counter`, {
      token: alexToken, body: { counterAmount: 70 },
    });
    expect(counter1.status).toBe(200);
    expect(counter1.data.status).toBe('countered');

    // Buyer counters back $65 (uses buyer-counter endpoint)
    const counter2 = await api.req('patch', `/api/offers/${offerId}/buyer-counter`, {
      token: jordanToken, body: { counterAmount: 65 },
    });
    expect(counter2.status, JSON.stringify(counter2.data)).toBe(200);
    expect(counter2.data.status).toBe('buyer_countered');

    // Seller accepts buyer's counter
    const accept = await api.req('patch', `/api/offers/${offerId}/seller-accept-buyer-counter`, {
      token: alexToken, body: {},
    });
    expect(accept.status, JSON.stringify(accept.data)).toBe(200);
    expect(accept.data.offer.status).toBe('accepted');
    expect(accept.data.offer.acceptedPrice).toBe(65);
  });

  test('declining an offer works (seller declines)', async () => {
    const listing4 = await api.req('post', '/api/listings', {
      token: alexToken,
      body: {
        title: `PROD-E2E ${RUN_ID} decline-test`,
        description: `Decline test ${RUN_ID}`,
        price: 40, category: 'Clothing', brand: 'E2EBrand', size: 'XL',
        condition: 'New with tags', quantity: 1,
        domesticShipping: 'flat', shippingCost: 7.24, shipsFrom: 'US',
      },
    });
    expect(listing4.status).toBe(201);
    const l4 = listing4.data.listing || listing4.data;

    const offer = await api.req('post', '/api/offers', {
      token: jordanToken, body: { listingId: l4._id, amount: 20, message: 'lowball' },
    });
    expect(offer.status).toBe(201);
    const offerId = offer.data._id;

    const decline = await api.req('patch', `/api/offers/${offerId}/decline`, {
      token: alexToken, body: {},
    });
    expect(decline.status, JSON.stringify(decline.data)).toBe(200);
    expect(decline.data.status).toBe('declined');
  });
});
