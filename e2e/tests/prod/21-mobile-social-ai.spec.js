const { test } = require('@playwright/test');
const { makeApi, loadState, RUN_ID, expect } = require('./helpers');

test.describe('21 - Mobile, social commerce, AI (production)', () => {
  let api, alexToken, jordanToken, state;

  test.beforeAll(async () => {
    api = await makeApi();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
    state = loadState();
  });
  test.afterAll(async () => { await api.dispose(); });

  test('mobile: features, preferences, push-token, barcode, shipping-estimate', async () => {
    var feat = await api.req('get', '/api/mobile/features');
    expect(feat.status).toBe(200);
    expect(feat.data.pushNotifications).toBe(true);
    var prefs = await api.req('get', '/api/mobile/preferences', { token: alexToken });
    expect(prefs.status).toBe(200);
    var upd = await api.req('put', '/api/mobile/preferences', {
      token: alexToken,
      body: { pushNotifications: true, biometric: true },
    });
    expect(upd.status).toBe(200);
    var reg = await api.req('post', '/api/mobile/push-token', {
      token: alexToken,
      body: { token: 'e2e-push-token-' + RUN_ID, platform: 'iOS' },
    });
    expect(reg.status).toBe(200);
    var unreg = await api.req('delete', '/api/mobile/push-token', {
      token: alexToken,
      body: { token: 'e2e-push-token-' + RUN_ID },
    });
    expect(unreg.status).toBe(200);
    var bc = await api.req('post', '/api/mobile/barcode-lookup', {
      token: alexToken,
      body: { barcode: '1234567890' },
    });
    expect(bc.status).toBe(200);
    var est = await api.req('get', '/api/mobile/shipping-estimate?country=US&weight=1');
    expect(est.status).toBe(200);
    expect(est.data.shippingCost).toBeGreaterThanOrEqual(0);
  });

  test('social-commerce: available, connect, sync, stats, disconnect', async () => {
    var avail = await api.req('get', '/api/social-commerce/available');
    expect(avail.status).toBe(200);
    expect(Array.isArray(avail.data)).toBe(true);
    var conn = await api.req('post', '/api/social-commerce/connect', {
      token: alexToken,
      body: { platform: 'instagram', accountId: 'e2e-account', accessToken: 'e2e-token' },
    });
    expect(conn.status).toBe(200);
    var id = conn.data._id;
    var sync = await api.req('post', '/api/social-commerce/' + id + '/sync', { token: alexToken });
    expect(sync.status).toBe(200);
    var stats = await api.req('get', '/api/social-commerce/' + id + '/stats', { token: alexToken });
    expect(stats.status).toBe(200);
    var del = await api.req('delete', '/api/social-commerce/' + id, { token: alexToken });
    expect(del.status).toBe(200);
  });

  test('video-shopping: upload, list, public, like, share, analytics', async () => {
    // Create a fresh listing for video testing
    var fresh = await api.req('post', '/api/listings', {
      token: alexToken,
      body: { title: 'PROD-E2E ' + RUN_ID + ' Video', description: 'test', price: 30, category: 'Clothing', condition: 'Good', quantity: 1 },
    });
    expect([200, 201]).toContain(fresh.status);
    var freshId = (fresh.data.listing || fresh.data)._id;
    var up = await api.req('post', '/api/video-shopping/upload', {
      token: alexToken,
      body: { listingId: freshId, videoUrl: 'https://e2e.test/video.mp4', title: 'E2E Video' },
    });
    expect(up.status).toBe(201);
    var id = up.data._id;
    var list = await api.req('get', '/api/video-shopping', { token: alexToken });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data)).toBe(true);
    var pub = await api.req('get', '/api/video-shopping/public', { token: alexToken });
    expect(pub.status).toBe(200);
    var like = await api.req('post', '/api/video-shopping/' + id + '/like', { token: jordanToken });
    expect(like.status).toBe(200);
    var share = await api.req('post', '/api/video-shopping/' + id + '/share', { token: jordanToken });
    expect(share.status).toBe(200);
    var an = await api.req('get', '/api/video-shopping/analytics/' + id, { token: alexToken });
    expect(an.status).toBe(200);
    var del = await api.req('delete', '/api/video-shopping/' + id, { token: alexToken });
    expect(del.status).toBe(200);
  });

  test('virtual-try-on: settings, session, status', async () => {
    var set = await api.req('get', '/api/virtual-try-on/settings');
    expect(set.status).toBe(200);
    expect(set.data.enabled).toBe(true);
    var st = await api.req('get', '/api/virtual-try-on/status');
    expect(st.status).toBe(200);
    // Create a fresh listing for try-on testing
    var fresh = await api.req('post', '/api/listings', {
      token: jordanToken,
      body: { title: 'PROD-E2E ' + RUN_ID + ' TryOn', description: 'test', price: 30, category: 'Clothing', condition: 'Good', quantity: 1 },
    });
    expect([200, 201]).toContain(fresh.status);
    var freshId = (fresh.data.listing || fresh.data)._id;
    var sess = await api.req('post', '/api/virtual-try-on/session', {
      token: jordanToken,
      body: { listingId: freshId, sessionType: 'ar', measurements: { bust: 36, waist: 28, hip: 38 } },
    });
    expect(sess.status).toBe(200);
    expect(sess.data.fitAnalysis.recommendedSize).toBeTruthy();
  });

  test('ai-stylist: preferences, recommendations, generate, outfits, trends', async () => {
    var prefs = await api.req('get', '/api/ai-stylist/preferences', { token: alexToken });
    expect(prefs.status).toBe(200);
    var upd = await api.req('put', '/api/ai-stylist/preferences', {
      token: alexToken,
      body: { preferences: { categories: ['Women'], brands: ['Nike'] } },
    });
    expect(upd.status).toBe(200);
    var gen = await api.req('post', '/api/ai-stylist/generate', { token: alexToken });
    expect(gen.status).toBe(200);
    expect(Array.isArray(gen.data)).toBe(true);
    var rec = await api.req('get', '/api/ai-stylist/recommendations', { token: alexToken });
    expect(rec.status).toBe(200);
    var outfits = await api.req('get', '/api/ai-stylist/outfits', { token: alexToken });
    expect(outfits.status).toBe(200);
    var trends = await api.req('get', '/api/ai-stylist/trends');
    expect(trends.status).toBe(200);
  });

  test('ar-showrooms: list, create, add-item, like', async () => {
    var list = await api.req('get', '/api/ar-showrooms');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data.showrooms)).toBe(true);
    var cr = await api.req('post', '/api/ar-showrooms', {
      token: alexToken,
      body: { name: 'PROD-E2E ' + RUN_ID + ' Room', description: 'test', roomType: 'bedroom' },
    });
    expect(cr.status).toBe(201);
    var id = cr.data._id;
    // Create a fresh listing for the showroom
    var fresh = await api.req('post', '/api/listings', {
      token: alexToken,
      body: { title: 'PROD-E2E ' + RUN_ID + ' AR', description: 'test', price: 30, category: 'Clothing', condition: 'Good', quantity: 1 },
    });
    expect([200, 201]).toContain(fresh.status);
    var freshId = (fresh.data.listing || fresh.data)._id;
    var add = await api.req('post', '/api/ar-showrooms/' + id + '/items', {
      token: alexToken,
      body: { listingId: freshId },
    });
    expect(add.status).toBe(200);
    var like = await api.req('post', '/api/ar-showrooms/' + id + '/like', { token: jordanToken });
    expect(like.status).toBe(200);
  });
});
