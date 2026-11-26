const { test } = require('@playwright/test');
const { makeApi, loadState, RUN_ID, expect } = require('./helpers');

test.describe('19 - Shipping & logistics (production)', () => {
  let api, alexToken, jordanToken, state;

  test.beforeAll(async () => {
    api = await makeApi();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
    state = loadState();
  });
  test.afterAll(async () => { await api.dispose(); });

  test('shipping: carriers, countries, currencies (public)', async () => {
    var r = await api.req('get', '/api/shipping/carriers');
    expect(r.status).toBe(200);
    var c = await api.req('get', '/api/shipping/countries');
    expect(c.status).toBe(200);
    var cu = await api.req('get', '/api/shipping/currencies');
    expect(cu.status).toBe(200);
  });

  test('shipping: calculate cost US to US', async () => {
    var r = await api.req('post', '/api/shipping/calculate', {
      body: { fromCountry: 'US', toCountry: 'US', weightKg: 1, itemPrice: 50 },
    });
    expect(r.status).toBe(200);
    expect(r.data.cost).toBeGreaterThan(0);
  });

  test('shipping: calculate cost international', async () => {
    var r = await api.req('post', '/api/shipping/calculate', {
      body: { fromCountry: 'US', toCountry: 'GB', weightKg: 1, itemPrice: 50 },
    });
    expect(r.status).toBe(200);
    expect(r.data.cost).toBeGreaterThan(0);
  });

  test('shipping: calculate-breakdown with full payment details', async () => {
    var r = await api.req('post', '/api/shipping/calculate-breakdown', {
      body: { itemPrice: 50, fromCountry: 'US', toCountry: 'US', weightKg: 1 },
    });
    expect(r.status).toBe(200);
    expect(r.data).toBeTruthy();
  });

  test('seller carrier integrations are removed; postage is platform-owned', async () => {
    var removed = await api.req('post', '/api/advanced-shipping', {
      token: alexToken,
      body: { carrier: 'fedex', apiKey: 'e2e-key', accountNumber: 'e2e-account' },
    });
    expect(removed.status).toBe(404);
  });

  test('cross-border: settings get/update, countries list', async () => {
    var get = await api.req('get', '/api/cross-border', { token: alexToken });
    expect(get.status).toBe(200);
    var upd = await api.req('put', '/api/cross-border', {
      token: alexToken,
      body: { country: 'US', currency: 'USD', taxId: 'E2E-TAX' },
    });
    expect(upd.status).toBe(200);
    var co = await api.req('get', '/api/cross-border/countries');
    expect(co.status).toBe(200);
    expect(Array.isArray(co.data)).toBe(true);
  });

  test('size-guides: list categories, get by category, suggestions, recommendations', async () => {
    var list = await api.req('get', '/api/size-guides');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data)).toBe(true);
    var women = await api.req('get', '/api/size-guides/Women');
    expect(women.status).toBe(200);
    expect(women.data.sizing).toBeTruthy();
    var sug = await api.req('get', '/api/size-guides/suggestions/Women/M');
    expect(sug.status).toBe(200);
    var rec = await api.req('post', '/api/size-guides/recommendations', {
      token: alexToken,
      body: { bust: 36, waist: 28, hip: 38, height: 65, weight: 140 },
    });
    expect(rec.status).toBe(200);
    expect(rec.data.recommendedSize).toBeTruthy();
  });
});
