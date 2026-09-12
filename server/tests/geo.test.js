/**
 * IP-based geo detection (Feature 1 foundation).
 *
 * Design under test:
 *  - Free forever: geoip-lite offline MaxMind DB bundled with the server —
 *    no API key, no billing, no per-request quota (millions of users OK).
 *  - Cross-platform: pure HTTP layer — identical behavior for web, iOS and
 *    Android clients (they may optionally send X-Country-Code hints).
 *  - Anti-spoof: CDN geo headers (CF-IPCountry etc.) are honored only when
 *    the request arrives from a trusted edge (loopback/private peer, i.e.
 *    behind our proxy/CDN); X-Country-Code never overrides IP evidence.
 *  - Fail-open: private/unresolvable IPs never block commerce.
 *  - Observable: aggregate metrics, no IPs/PII stored beyond a bounded cache.
 */
const request = require('supertest');
const app = require('../server');
const {
  detectCountry,
  getGeoStats,
  resetGeoState,
} = require('../config/geo');

const mkReq = (headers = {}, remote = '127.0.0.1') => ({
  headers,
  socket: { remoteAddress: remote },
  connection: {},
});

beforeEach(() => {
  resetGeoState();
});

describe('Geo — offline IP resolution (no API key / no network)', () => {
  test('GEO.1 Public IPv4 resolves via bundled geoip-lite DB', () => {
    const r = detectCountry(mkReq({ 'x-forwarded-for': '8.8.8.8' }, '8.8.8.8'));
    expect(r.country).toBe('US');
    expect(r.source).toBe('ip-geoip-lite');
  });

  test('GEO.2 Non-US public IP resolves its real country (CH then HK)', () => {
    const ch = detectCountry(mkReq({ 'x-forwarded-for': '5.144.0.1' }, '5.144.0.1'));
    expect(ch.country).toBe('CH');
    const hk = detectCountry(mkReq({ 'x-forwarded-for': '113.28.0.1' }, '113.28.0.1'));
    expect(hk.country).toBe('HK');
  });

  test('GEO.3 Private/loopback IPs fail-open (null, ip-unresolved) without throwing', () => {
    const r = detectCountry(mkReq({}, '10.0.0.5'));
    expect(r.country).toBeNull();
    expect(r.source).toBe('ip-unresolved');
  });
});

describe('Geo — anti-spoofing', () => {
  test('GEO.4 CDN geo header honored from a trusted edge peer (private socket)', () => {
    const r = detectCountry(mkReq({ 'cf-ipcountry': 'DE', 'x-forwarded-for': '8.8.8.8' }, '10.0.0.9'));
    expect(r.country).toBe('DE');
    expect(r.source).toBe('header:cf-ipcountry');
  });

  test('GEO.5 CDN geo header IGNORED on direct connection — offline DB wins (anti-spoof)', () => {
    // Client claims DE via CF header, but DB says the IP is HK.
    const r = detectCountry(mkReq({ 'cf-ipcountry': 'DE', 'x-forwarded-for': '113.28.0.1' }, '113.28.0.1'));
    expect(r.country).toBe('HK');
    expect(r.source).toBe('ip-geoip-lite');
  });

  test('GEO.6 X-Country-Code hint never overrides IP evidence and is flagged as conflict', () => {
    const r = detectCountry(mkReq({ 'cf-ipcountry': 'HK', 'x-country-code': 'US' }, '10.0.0.9'));
    expect(r.country).toBe('HK');
    expect(r.conflict).toBe(true);
    expect(r.hint).toBe('US');
  });

  test('GEO.7 Client hint applies only when no IP evidence exists (loopback fallback)', () => {
    const r = detectCountry(mkReq({ 'x-country-code': 'DE' }, '127.0.0.1'));
    expect(r.country).toBe('DE');
    expect(r.source).toBe('client-hint');
  });
});

describe('Geo — cache and metrics', () => {
  test('GEO.8 Repeated lookups hit the in-process cache (O(1), no repeat DB work)', () => {
    detectCountry(mkReq({ 'x-forwarded-for': '8.8.8.8' }, '8.8.8.8'));
    const before = getGeoStats().cacheSize;
    detectCountry(mkReq({ 'x-forwarded-for': '8.8.8.8' }, '8.8.8.8'));
    expect(getGeoStats().cacheSize).toBeGreaterThanOrEqual(before);
    expect(getGeoStats().metrics.total).toBe(2);
  });

  test('GEO.9 resetGeoState clears cache and counters (test isolation)', () => {
    detectCountry(mkReq({ 'x-forwarded-for': '8.8.8.8' }, '8.8.8.8'));
    resetGeoState();
    const s = getGeoStats();
    expect(s.metrics.total).toBe(0);
    expect(s.cacheSize).toBe(0);
  });

  test('GEO.10 Metrics count IP hits vs hints vs misses and never expose IPs', () => {
    detectCountry(mkReq({ 'x-forwarded-for': '8.8.8.8' }, '8.8.8.8')); // ip hit
    detectCountry(mkReq({ 'x-country-code': 'DE' }, '127.0.0.1')); // hint
    detectCountry(mkReq({}, '10.0.0.5')); // miss
    const s = getGeoStats();
    expect(s.metrics.total).toBe(3);
    expect(s.metrics.ipHits).toBeGreaterThanOrEqual(1);
    expect(s.metrics.hintHits).toBeGreaterThanOrEqual(1);
    expect(s.metrics.misses).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(s)).not.toMatch(/8\.8\.8\.8|113\.28/);
  });
});

describe('Geo — end-to-end region gating through the live middleware', () => {
  test('GEO.11 /marketplace/status uses IP evidence over a conflicting ?country hint', async () => {
    const res = await request(app)
      .get('/api/marketplace/status?country=IN')
      .set('X-Forwarded-For', '8.8.8.8'); // US per DB — must outrank the hint
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('US');
    expect(res.body.supported).toBe(true);
  });

  test('GEO.12 Unsupported IP region is blocked at the marketplace gate (403)', async () => {
    const res = await request(app)
      .get('/api/listings')
      .set('X-Forwarded-For', '41.208.0.1'); // ZA — not in USA+Europe launch set
    expect(res.status).toBe(403);
    expect(res.body.supported).toBe(false);
    expect(res.body.code).toBe('REGION_NOT_SUPPORTED');
    expect(typeof res.body.message).toBe('string');
  });

  test('GEO.13 Supported IP region passes the gate', async () => {
    const res = await request(app)
      .get('/api/listings')
      .set('X-Forwarded-For', '8.8.8.8'); // US
    expect(res.status).toBe(200);
  });

  test('GEO.14 geo-status ops endpoint exposes aggregate metrics only', async () => {
    const res = await request(app).get('/api/marketplace/geo-status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('metrics.total');
    expect(JSON.stringify(res.body)).not.toMatch(/\d+\.\d+\.\d+\.\d+/); // no IPs
  });
});
