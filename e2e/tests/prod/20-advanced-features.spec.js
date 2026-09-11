const { test } = require('@playwright/test');
const { makeApi, loadState, RUN_ID, expect } = require('./helpers');

test.describe('20 - Advanced features (production)', () => {
  let api, alexToken, jordanToken, state;

  test.beforeAll(async () => {
    api = await makeApi();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
    state = loadState();
  });
  test.afterAll(async () => { await api.dispose(); });

  test('escrow: settings (public)', async () => {
    var r = await api.req('get', '/api/escrow/settings');
    expect(r.status).toBe(200);
    expect(r.data.threshold).toBeGreaterThan(0);
  });

  test('escrow: cannot initiate for low-value item (<$500)', async () => {
    var r = await api.req('post', '/api/escrow/initiate', {
      token: jordanToken,
      body: { transactionId: state.txns.C ? state.txns.C.id : '000000000000000000000000', amount: 100 },
    });
    expect(r.status).toBe(400);
  });

  test('fraud: settings + check endpoint', async () => {
    var set = await api.req('get', '/api/fraud/settings');
    expect(set.status).toBe(200);
    var check = await api.req('post', '/api/fraud/check', {
      token: jordanToken,
      body: { listingId: state.listings.A.id, amount: 50 },
    });
    expect(check.status).toBe(200);
    expect(check.data.riskLevel).toMatch(/low|medium|high/);
    expect(typeof check.data.riskScore).toBe('number');
  });

  test('live-events: list, create, join, leave, purchase', async () => {
    var list = await api.req('get', '/api/live-events');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data.events)).toBe(true);
    var now = new Date(), end = new Date(Date.now() + 3600 * 1000);
    var cr = await api.req('post', '/api/live-events', {
      token: alexToken,
      body: { title: 'PROD-E2E ' + RUN_ID + ' Live', description: 'test', listingIds: [state.listings.A.id], startTime: now.toISOString(), endTime: end.toISOString() },
    });
    expect(cr.status).toBe(201);
    var id = cr.data._id;
    var join = await api.req('post', '/api/live-events/' + id + '/join', { token: jordanToken });
    expect(join.status).toBe(200);
    var leave = await api.req('post', '/api/live-events/' + id + '/leave', { token: jordanToken });
    expect(leave.status).toBe(200);
    var pur = await api.req('post', '/api/live-events/' + id + '/purchase', {
      token: jordanToken,
      body: { listingId: state.listings.A.id },
    });
    expect([200, 400]).toContain(pur.status);
  });

  test('inventory: list, sync, alerts, auto-reorder', async () => {
    var list = await api.req('get', '/api/inventory', { token: alexToken });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data)).toBe(true);
    var sync = await api.req('post', '/api/inventory/sync', {
      token: alexToken,
      body: { warehouse: 'e2e-warehouse', items: [{ listingId: state.listings.A.id, quantity: 10 }] },
    });
    expect(sync.status).toBe(200);
    var alerts = await api.req('post', '/api/inventory/alerts', { token: alexToken });
    expect(alerts.status).toBe(200);
    expect(Array.isArray(alerts.data.alerts)).toBe(true);
  });

  test('bulk-listings: bulk status update', async () => {
    // Create a fresh listing for bulk operations
    var fresh = await api.req('post', '/api/listings', {
      token: alexToken,
      body: { title: 'PROD-E2E ' + RUN_ID + ' Bulk', description: 'bulk test', price: 30, category: 'Clothing', condition: 'Good', quantity: 1 },
    });
    expect([200, 201]).toContain(fresh.status);
    var freshId = (fresh.data.listing || fresh.data)._id;
    var r = await api.req('patch', '/api/listings/bulk-status', {
      token: alexToken,
      body: { listingIds: [freshId], status: 'active' },
    });
    expect(r.status).toBe(200);
    expect(r.data.modified).toBeGreaterThanOrEqual(0);
  });

  test('bulk-listings: bulk price update', async () => {
    var fresh = await api.req('post', '/api/listings', {
      token: alexToken,
      body: { title: 'PROD-E2E ' + RUN_ID + ' BulkP', description: 'bulk test', price: 30, category: 'Clothing', condition: 'Good', quantity: 1 },
    });
    expect([200, 201]).toContain(fresh.status);
    var freshId = (fresh.data.listing || fresh.data)._id;
    var r = await api.req('patch', '/api/listings/bulk-price', {
      token: alexToken,
      body: { listingIds: [freshId], price: 42 },
    });
    expect(r.status).toBe(200);
  });

  test('bulk-listings: bulk delete', async () => {
    var fresh = await api.req('post', '/api/listings', {
      token: alexToken,
      body: { title: 'PROD-E2E ' + RUN_ID + ' BulkD', description: 'bulk test', price: 30, category: 'Clothing', condition: 'Good', quantity: 1 },
    });
    expect([200, 201]).toContain(fresh.status);
    var freshId = (fresh.data.listing || fresh.data)._id;
    var r = await api.req('delete', '/api/listings/bulk', {
      token: alexToken,
      body: { listingIds: [freshId] },
    });
    expect(r.status).toBe(200);
  });

  test('bulk-listings: bulk export CSV', async () => {
    var r = await api.req('get', '/api/listings/bulk-export', { token: alexToken });
    expect(r.status).toBe(200);
  });
});
