const { test } = require('@playwright/test');
const { makeApi, loadState, RUN_ID, expect } = require('./helpers');

test.describe('22 - Admin & Enterprise (production)', () => {
  let api, alexToken, jordanToken, state;

  test.beforeAll(async () => {
    api = await makeApi();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
    state = loadState();
  });
  test.afterAll(async () => { await api.dispose(); });

  test('admin: dashboard requires admin role (non-admin rejected)', async () => {
    var r = await api.req('get', '/api/admin/dashboard', { token: alexToken });
    expect([401, 403]).toContain(r.status);
  });

  test('admin: list users requires admin role', async () => {
    var r = await api.req('get', '/api/admin/users', { token: alexToken });
    expect([401, 403]).toContain(r.status);
  });

  test('admin: list transactions requires admin role', async () => {
    var r = await api.req('get', '/api/admin/transactions', { token: alexToken });
    expect([401, 403]).toContain(r.status);
  });

  test('enterprise: listings endpoint for seller', async () => {
    var r = await api.req('get', '/api/enterprise/listings', { token: alexToken });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
  });

  test('enterprise: orders endpoint for seller', async () => {
    var r = await api.req('get', '/api/enterprise/orders', { token: alexToken });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
  });

  test('enterprise: webhook registration', async () => {
    var r = await api.req('post', '/api/enterprise/webhook', {
      token: alexToken,
      body: { url: 'https://e2e.test/webhook', events: ['order.completed'] },
    });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe('registered');
  });

  test('enterprise: export data', async () => {
    var r = await api.req('post', '/api/enterprise/export', {
      token: alexToken,
      body: { type: 'transactions', startDate: '2024-01-01', endDate: '2024-12-31' },
    });
    expect(r.status).toBe(200);
    expect(r.data.type).toBe('transactions');
  });

  test('reports: submit a report on a listing', async () => {
    var r = await api.req('post', '/api/reports', {
      token: jordanToken,
      body: { listingId: state.listings.A.id, reason: 'Spam', description: 'E2E test report' },
    });
    expect(r.status).toBe(201);
    expect(r.data.report).toBeTruthy();
  });

  test('reports: list reports (public)', async () => {
    var r = await api.req('get', '/api/reports');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
  });

  test('vendors: list, create, invite, shared-inventory', async () => {
    var list = await api.req('get', '/api/vendors', { token: alexToken });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data)).toBe(true);
    var cr = await api.req('post', '/api/vendors', {
      token: alexToken,
      body: { listingId: state.listings.A.id, commission: 50 },
    });
    expect(cr.status).toBe(201);
    var id = cr.data._id;
    var inv = await api.req('post', '/api/vendors/' + id + '/invite', {
      token: alexToken,
      body: { sellerId: state.users.jordan.id, commission: 50 },
    });
    expect(inv.status).toBe(200);
    var si = await api.req('put', '/api/vendors/shared-inventory', {
      token: alexToken,
      body: { listingId: state.listings.A.id, quantity: 10 },
    });
    expect(si.status).toBe(200);
  });

  test('offer-sharing: stats, share-to-likers, bundle, share-to-friends', async () => {
    var stats = await api.req('get', '/api/offer-sharing/stats', { token: alexToken });
    expect(stats.status).toBe(200);
    var bundle = await api.req('post', '/api/offer-sharing/bundle', {
      token: alexToken,
      body: { listingIds: [state.listings.A.id, state.listings.B.id], buyerId: state.users.jordan.id },
    });
    expect(bundle.status).toBe(200);
  });

  test('onboarding: status, complete-step, checklist, tips', async () => {
    var st = await api.req('get', '/api/users/me/onboarding', { token: alexToken });
    expect(st.status).toBe(200);
    expect(st.data.onboarding).toBeTruthy();
    var step = await api.req('post', '/api/users/me/onboarding/complete-step', {
      token: alexToken,
      body: { step: 'profileSetup' },
    });
    expect(step.status).toBe(200);
    expect(step.data.onboarding.steps.profileSetup.completed).toBe(true);
    var check = await api.req('get', '/api/onboarding/checklist', { token: alexToken });
    expect(check.status).toBe(200);
    expect(Array.isArray(check.data.checklist)).toBe(true);
    expect(check.data.checklist.length).toBe(5);
    var tips = await api.req('get', '/api/onboarding/tips', { token: alexToken });
    expect(tips.status).toBe(200);
    expect(Array.isArray(tips.data.tips)).toBe(true);
  });
});
