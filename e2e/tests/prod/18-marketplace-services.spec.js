const { test } = require('@playwright/test');
const { makeApi, loadState, RUN_ID, expect } = require('./helpers');

test.describe('18 - Marketplace services (production)', () => {
  let api, alexToken, jordanToken, state;

  test.beforeAll(async () => {
    api = await makeApi();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
    state = loadState();
  });
  test.afterAll(async () => { await api.dispose(); });

  test('search: brands aggregation endpoint', async () => {
    var r = await api.req('get', '/api/search/brands');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
  });

  test('search: colors aggregation endpoint', async () => {
    var r = await api.req('get', '/api/search/colors?category=Clothing');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
  });

  test('search: sizes aggregation endpoint', async () => {
    var r = await api.req('get', '/api/search/sizes?category=Clothing');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
  });

  test('search: save and list saved searches', async () => {
    var save = await api.req('post', '/api/search/save', {
      token: alexToken,
      body: { query: 'vintage', filters: { category: 'Clothing' }, name: 'E2E Saved Search' },
    });
    expect(save.status).toBe(200);
    var list = await api.req('get', '/api/search/saved', { token: alexToken });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data)).toBe(true);
  });

  test('saved-searches: full CRUD lifecycle', async () => {
    var cr = await api.req('post', '/api/saved-searches', {
      token: alexToken,
      body: { name: 'PROD-E2E ' + RUN_ID + ' Search', query: 'jacket', filters: { category: 'Men' } },
    });
    expect(cr.status).toBe(201);
    var id = cr.data._id;
    var list = await api.req('get', '/api/saved-searches', { token: alexToken });
    expect(list.status).toBe(200);
    var results = await api.req('get', '/api/saved-searches/' + id + '/results', { token: alexToken });
    expect(results.status).toBe(200);
    expect(Array.isArray(results.data.listings)).toBe(true);
    var upd = await api.req('put', '/api/saved-searches/' + id, { token: alexToken, body: { name: 'Updated' } });
    expect(upd.status).toBe(200);
    var del = await api.req('delete', '/api/saved-searches/' + id, { token: alexToken });
    expect(del.status).toBe(200);
  });

  test('price-history: track and retrieve', async () => {
    var post = await api.req('post', '/api/pricehistory', {
      token: alexToken,
      body: { listingId: state.listings.A.id, price: 45 },
    });
    expect(post.status).toBe(201);
    var get = await api.req('get', '/api/pricehistory/' + state.listings.A.id);
    expect(get.status).toBe(200);
    expect(Array.isArray(get.data)).toBe(true);
  });

  test('price-suggestions: settings, suggest, similar, trends', async () => {
    var set = await api.req('get', '/api/price-suggestions/settings');
    expect(set.status).toBe(200);
    var sug = await api.req('post', '/api/price-suggestions/suggest', {
      token: alexToken,
      body: { title: 'Vintage Jacket', category: 'Women', brand: 'Nike', condition: 'Good' },
    });
    expect(sug.status).toBe(200);
    expect(sug.data.suggestedPrice).toBeGreaterThan(0);
    var sim = await api.req('post', '/api/price-suggestions/similar', {
      token: alexToken,
      body: { title: 'Jacket', category: 'Women' },
    });
    expect(sim.status).toBe(200);
    var tr = await api.req('get', '/api/price-suggestions/trends');
    expect(tr.status).toBe(200);
  });

  test('recently-viewed: record, list, clear', async () => {
    var rec = await api.req('post', '/api/recently-viewed/' + state.listings.A.id, { token: jordanToken });
    expect([200, 201]).toContain(rec.status);
    var list = await api.req('get', '/api/recently-viewed', { token: jordanToken });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data.items)).toBe(true);
    var clear = await api.req('delete', '/api/recently-viewed/clear', { token: jordanToken });
    expect(clear.status).toBe(200);
  });

  test('trends: list, viral, refresh', async () => {
    var r = await api.req('get', '/api/trends');
    expect(r.status).toBe(200);
    var viral = await api.req('get', '/api/trends/viral');
    expect(viral.status).toBe(200);
  });

  test('trend-forecast: list, personalized, category', async () => {
    var r = await api.req('get', '/api/trend-forecast', { token: alexToken });
    expect(r.status).toBe(200);
    var per = await api.req('get', '/api/trend-forecast/personalized', { token: alexToken });
    expect(per.status).toBe(200);
    var gen = await api.req('post', '/api/trend-forecast/generate', { token: alexToken, body: { category: 'Women' } });
    expect(gen.status).toBe(200);
  });
});
