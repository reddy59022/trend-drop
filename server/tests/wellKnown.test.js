const request = require('supertest');
const app = require('../server');

// TD-2.4 deep link verification endpoints. Both /.well-known endpoints are
// key-gated on deployment env vars (signing-cert fingerprint for Android,
// Apple team ID for iOS). The handlers read process.env at request time, so
// tests toggle the vars directly and always restore them afterwards.
describe('Deep link verification endpoints (TD-2.4)', () => {
  const saved = {
    android: process.env.ANDROID_SHA256_FINGERPRINTS,
    ios: process.env.IOS_TEAM_ID,
  };

  afterEach(() => {
    if (saved.android === undefined) delete process.env.ANDROID_SHA256_FINGERPRINTS;
    else process.env.ANDROID_SHA256_FINGERPRINTS = saved.android;
    if (saved.ios === undefined) delete process.env.IOS_TEAM_ID;
    else process.env.IOS_TEAM_ID = saved.ios;
  });

  describe('GET /.well-known/assetlinks.json (Android App Links)', () => {
    it('returns 404 JSON when ANDROID_SHA256_FINGERPRINTS is unset', async () => {
      delete process.env.ANDROID_SHA256_FINGERPRINTS;
      const res = await request(app).get('/.well-known/assetlinks.json');
      expect(res.status).toBe(404);
      expect(res.type).toMatch(/json/);
      expect(res.body.status).toBe('not_configured');
    });

    it('returns 404 JSON for an empty fingerprints value', async () => {
      process.env.ANDROID_SHA256_FINGERPRINTS = '  , ';
      const res = await request(app).get('/.well-known/assetlinks.json');
      expect(res.status).toBe(404);
      expect(res.body.status).toBe('not_configured');
    });

    it('returns the verification statement when configured', async () => {
      process.env.ANDROID_SHA256_FINGERPRINTS =
        '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:AD:A3:7E:DD:6C:3F:5A:FA:19:2C:41:93:1E:6A:54:38';
      const res = await request(app).get('/.well-known/assetlinks.json');
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/json/);
      const entry = res.body[0];
      expect(entry.relation).toEqual(['delegate_permission/common.handle_all_urls']);
      expect(entry.target.namespace).toBe('android_app');
      expect(entry.target.package_name).toBe('com.trenddrop.app');
      expect(entry.target.sha256_cert_fingerprints).toEqual([
        '146DE983C5730650D8EEB9952F34FC64ADA37EDD6C3F5AFA192C41931E6A5438',
      ]);
    });

    it('normalizes colon-less base64 fingerprints', async () => {
      process.env.ANDROID_SHA256_FINGERPRINTS =
        '146de983c5730650d8eeb9952f34fc64ada37edd6c3f5afa192c41931e6a5438';
      const res = await request(app).get('/.well-known/assetlinks.json');
      expect(res.status).toBe(200);
      expect(res.body[0].target.sha256_cert_fingerprints).toEqual([
        '146DE983C5730650D8EEB9952F34FC64ADA37EDD6C3F5AFA192C41931E6A5438',
      ]);
    });

    it('handles multiple comma-separated fingerprints', async () => {
      process.env.ANDROID_SHA256_FINGERPRINTS =
        'AA:BB:CC, DD:EE:FF';
      const res = await request(app).get('/.well-known/assetlinks.json');
      expect(res.status).toBe(200);
      expect(res.body[0].target.sha256_cert_fingerprints).toEqual(['AABBCC', 'DDEEFF']);
    });
  });

  describe('GET /.well-known/apple-app-site-association (iOS Universal Links)', () => {
    it('returns 404 JSON when IOS_TEAM_ID is unset', async () => {
      delete process.env.IOS_TEAM_ID;
      const res = await request(app).get('/.well-known/apple-app-site-association');
      expect(res.status).toBe(404);
      expect(res.type).toMatch(/json/);
      expect(res.body.status).toBe('not_configured');
    });

    it('returns 404 JSON for a malformed team id', async () => {
      process.env.IOS_TEAM_ID = 'not-a-team-id!!';
      const res = await request(app).get('/.well-known/apple-app-site-association');
      expect(res.status).toBe(404);
      expect(res.body.status).toBe('not_configured');
    });

    it('returns the applinks statement when configured', async () => {
      process.env.IOS_TEAM_ID = 'A1B2C3D4E5';
      const res = await request(app).get('/.well-known/apple-app-site-association');
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/json/);
      expect(res.body.applinks.apps).toEqual([]);
      const details = res.body.applinks.details;
      expect(details).toHaveLength(1);
      expect(details[0].appID).toBe('A1B2C3D4E5.com.trenddrop.app');
      // Every in-app deep link target the client routes must be allowed.
      for (const path of ['/listing/*', '/orders/*', '/messages', '/profile/*', '/collections/*', '/auctions/*']) {
        expect(details[0].paths).toContain(path);
      }
    });
  });
});
