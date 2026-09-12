/**
 * Geo-driven country + currency selection (top-right selectors).
 *
 * Requirement: on every client (web, iOS, Android) the top-right country and
 * currency selectors must be auto-selected from the visitor's IP address.
 *
 * Contract under test: GET /api/marketplace/status must return BOTH the
 * IP-resolved country AND the currency for that country, so a single call
 * lets any client auto-select its top-right selectors. Native Capacitor apps
 * reach the same endpoint over HTTPS, so the server sees the device's real
 * public IP — identical behavior for all three platforms.
 */
const request = require('supertest');
const app = require('../server');
const { resetGeoState } = require('../config/geo');

beforeEach(() => {
  resetGeoState();
});

describe('GeoCurrency — /marketplace/status returns IP-derived country + currency', () => {
  test('GEOC.1 US IP (8.8.8.8) resolves to US + USD and is supported', async () => {
    const res = await request(app)
      .get('/api/marketplace/status')
      .set('X-Forwarded-For', '8.8.8.8');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('US');
    expect(res.body.currency).toBe('USD');
    expect(res.body.supported).toBe(true);
  });

  test('GEOC.2 Swiss IP (5.144.0.1) resolves to CH + CHF (non-EUR launch currency)', async () => {
    const res = await request(app)
      .get('/api/marketplace/status')
      .set('X-Forwarded-For', '5.144.0.1');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('CH');
    expect(res.body.currency).toBe('CHF');
  });

  test('GEOC.3 CDN geo header GB behind a trusted edge → GB + GBP', async () => {
    const res = await request(app)
      .get('/api/marketplace/status')
      .set('CF-IPCountry', 'GB')
      .set('X-Forwarded-For', '8.8.8.8');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('GB');
    expect(res.body.currency).toBe('GBP');
    expect(res.body.source).toBe('header:cf-ipcountry');
  });

  test('GEOC.4 Eurozone (CF-IPCountry DE) → DE + EUR', async () => {
    const res = await request(app)
      .get('/api/marketplace/status')
      .set('CF-IPCountry', 'DE')
      .set('X-Forwarded-For', '8.8.8.8');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('DE');
    expect(res.body.currency).toBe('EUR');
  });

  test('GEOC.5 Unsupported region (ZA IP) still returns its own currency (ZAR) so the block screen can localize', async () => {
    const res = await request(app)
      .get('/api/marketplace/status')
      .set('X-Forwarded-For', '41.208.0.1');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('ZA');
    expect(res.body.currency).toBe('ZAR');
    expect(res.body.supported).toBe(false);
  });

  test('GEOC.6 No IP evidence (localhost, no hint) fails open to the US default + USD', async () => {
    const res = await request(app).get('/api/marketplace/status');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('US');
    expect(res.body.currency).toBe('USD');
  });

  test('GEOC.7 Client hint only (loopback + lowercase X-Country-Code) is normalized → GB + GBP', async () => {
    const res = await request(app)
      .get('/api/marketplace/status')
      .set('X-Country-Code', 'gb');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('GB');
    expect(res.body.currency).toBe('GBP');
  });

  test('GEOC.8 Anti-spoof: US IP beats an IN hint → US + USD (never INR)', async () => {
    const res = await request(app)
      .get('/api/marketplace/status?country=IN')
      .set('X-Forwarded-For', '8.8.8.8');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('US');
    expect(res.body.currency).toBe('USD');
  });

  test('GEOC.9 Country unknown to config (XK) → currency falls back to USD, no crash', async () => {
    const res = await request(app)
      .get('/api/marketplace/status')
      .set('X-Country-Code', 'XK');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('XK');
    expect(res.body.currency).toBe('USD');
  });

  test('GEOC.10 Backwards compatible: legacy fields (supported/message/code/source) still present', async () => {
    const res = await request(app)
      .get('/api/marketplace/status')
      .set('X-Forwarded-For', '8.8.8.8');
    expect(res.body.supported).toBe(true);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.code).toBe('REGION_SUPPORTED');
    expect(typeof res.body.source).toBe('string');
  });

  test('GEOC.11 Currency contract: always a 3-letter uppercase ISO code across scenarios', async () => {
    const scenarios = [
      { ip: '8.8.8.8' },        // US
      { ip: '5.144.0.1' },      // CH
      { ip: '41.208.0.1' },     // ZA
      { headers: { 'X-Country-Code': 'JP' } },
      { headers: {} },          // unresolved
    ];
    for (const s of scenarios) {
      let req = request(app).get('/api/marketplace/status');
      if (s.ip) req = req.set('X-Forwarded-For', s.ip);
      if (s.headers) req = req.set(s.headers);
      const res = await req;
      expect(typeof res.body.currency).toBe('string');
      expect(res.body.currency).toMatch(/^[A-Z]{3}$/);
      expect(typeof res.body.country).toBe('string');
    }
  });
});
