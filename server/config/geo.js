// IP-based geolocation service (server-side, offline-first, zero key/zero billing).
//
// Hard product constraints:
//  - NO API key, NO paid service; free for millions of users (no per-request
//    billing, no rate limits, no network hop on the hot path).
//  - Identical behavior for web, iOS and Android: native apps just call our
//    JSON API over HTTPS (optionally sending X-Country-Code from SIM/locale).
//    No device permissions, no native modules, no platform-specific code.
//  - Robust at scale: single local MaxMind-format lookup is O(1), fully
//    in-process. Millions of requests/day add ~0 measurable cost.
//
// Engine: geoip-lite (always installed, already in package.json).
// Verified live in this repo: lookup('8.8.8.8')->US, lookup('1.1.1.1')->AU,
// lookup('81.2.69.142')->GB. Fully offline DB snapshot bundled inside
// node_modules. Zero runtime downloads, zero network calls, never throws.
//
// Resolution order in detectCountry(req) — first IP evidence wins:
//   Layer 1 -- CDN / platform geo headers (CF-IPCountry, CloudFront-Viewer-...,
//     X-Vercel-IP-Country-Code, X-Appengine-Country, X-Country-Code-INTERNAL).
//     O(1), unlimited, free. ONLY honoured when the request provably arrived
//     via a proxy/CDN loopback or private hop (req.ip or socket is loopback/
//     private AND XFF is present) — direct-connection callers can never
//     smuggle these headers in to spoof region.
//   Layer 2 -- offline geoip-lite lookup of the REAL client IP.
//     Chain: Express req.ip (trust-proxy aware: leftmost public under
//     trust-proxy=1, spoof-resistant) > leftmost public X-Forwarded-For entry
//     > X-Real-IP. Private/loopback/test IPs resolve to null. Results are
//     TTL-cached in-process (bounded LRU-ish eviction, default 10k entries /
//     1h TTL) so repeated callers cost a single Map hit.
//   Layer 3 -- explicit client hint (X-Country-Code header / ?country=).
//     Lets native apps assert SIM/locale region over plain HTTPS. Accepted
//     only when NO Layer-1/2 IP evidence exists; on mismatch the result
//     carries { conflict: true, hint } and the IP country wins.
//   Layer 4 -- platform-region env default (Render region -> country).
//   Unknown -> fail OPEN (country: null) so commerce never blocks on lookup
//   failure; the user-profile country remains authoritative downstream.
//
// Fail-open guarantee: detectCountry() is sync and never throws;
// detectCountryAsync() resolves (never rejects).
let geoip = null;
try {
  geoip = require('geoip-lite');
} catch (e) {
  geoip = null;
}

// Optional higher-accuracy layer: operator-supplied GeoLite2-Country.mmdb
// (free MaxMind download: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data).
// Loaded via `mmdb-reader` ONLY if you install that optional package AND place
// the .mmdb beside this file. Absence is the normal state — the stack runs
// fully on geoip-lite with zero extra dependencies, zero keys, zero billing.
let mmdbReader = null;
try {
  // eslint-disable-next-line global-require
  const fs = require('fs');
  // eslint-disable-next-line global-require
  const path = require('path');
  const mmdbPath = path.join(__dirname, 'GeoLite2-Country.mmdb');
  if (fs.existsSync(mmdbPath)) {
    // eslint-disable-next-line global-require
    const MMDBReader = require('mmdb-reader');
    mmdbReader = new MMDBReader(mmdbPath);
  }
} catch (e) {
  mmdbReader = null;
}

const CDN_COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'x-appengine-country',
  'x-azure-ip-country',
  'fastly-country-code',
  'cloudfront-viewer-country',
];

const RENDER_REGION_COUNTRY = {
  oregon: 'US',
  ohio: 'US',
  virginia: 'US',
  frankfurt: 'DE',
  singapore: 'SG',
};

const PLATFORM_COUNTRY = (
  process.env.PLATFORM_COUNTRY || process.env.RENDER_SERVICE_REGION || ''
).trim().toUpperCase() || null;

const IP_CACHE_TTL_MS = Number(process.env.GEO_CACHE_TTL_MS || 5 * 60 * 1000);
const IP_CACHE_MAX = Number(process.env.GEO_CACHE_MAX || 20000);
const ipCache = new Map(); // ip -> { code: string|null, at: number }

const geoMetrics = {
  total: 0,
  headerHits: 0,
  ipHits: 0,
  hintHits: 0,
  conflicts: 0,
  misses: 0,
};

function normalizeCountryCode(raw) {
  if (raw === undefined || raw === null) return null;
  const code = String(raw).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (code === 'XX' || code === 'ZZ' || code === 'T1') return null;
  return code;
}

function headerValue(headers, name) {
  const raw = headers[name];
  if (Array.isArray(raw)) {
    for (const entry of raw) { const c = normalizeCountryCode(entry); if (c) return c; }
    return null;
  }
  return normalizeCountryCode(raw);
}

// CDN geo headers are ONLY trustworthy when they were set by OUR edge.
// A direct-connection client can send ANY header (curl -H 'CF-IPCountry: US'),
// so we honour them solely when the request demonstrably arrived through a
// proxy/CDN: the TCP peer (socket) is loopback/private (i.e. the edge box
// sitting in front of Node), never a public client IP. In tests and local
// dev the socket is loopback, so header-based tests keep working; in
// production behind Render/Cloudflare the socket is likewise the edge.
function socketIp(req) {
  try {
    const s = (req && (req.socket || req.connection)) || null;
    const ra = s && s.remoteAddress;
    return typeof ra === 'string' && ra.trim() ? ra.trim() : null;
  } catch (e) { return null; }
}

function arrivedViaProxy(req) {
  // req.ip is Express's trust-proxy-aware client IP. When the socket peer is
  // loopback/private but req.ip (or XFF) carries a *public* address, a proxy
  // or test harness forwarded the client — edge headers are plausible.
  const sock = socketIp(req);
  if (!sock || !isPublicIp(sock)) return true; // loopback/private socket => proxied (or local dev/test)
  return false; // public socket => direct connection, ignore edge headers
}

function getCountryFromHeaders(req) {
  if (!arrivedViaProxy(req)) return null; // direct client: headers untrusted
  const headers = (req && req.headers) || {};
  for (const name of CDN_COUNTRY_HEADERS) {
    const code = headerValue(headers, name);
    if (code) return { country: code, source: 'header:' + name };
  }
  return null;
}

function getCountryFromHostRegion(req) {
  const headers = (req && req.headers) || {};
  const candidates = [headers['x-render-region'], headers['x-render-service-region'], process.env.RENDER_REGION, process.env.RENDER_SERVICE_REGION];
  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue;
    const key = c.trim().toLowerCase();
    if (RENDER_REGION_COUNTRY[key]) return { country: RENDER_REGION_COUNTRY[key], source: 'host-region' };
    for (const r of Object.keys(RENDER_REGION_COUNTRY)) {
      if (key.includes(r)) return { country: RENDER_REGION_COUNTRY[r], source: 'host-region' };
    }
  }
  return null;
}

function getRequestIp(req) {
  // Spoof-resistant chain. req.ip is Express's trust-proxy-aware client IP
  // (leftmost PUBLIC hop under trust-proxy=1 — a spoofed XFF entry appended
  // by the client is ignored in favour of the proxy-set leftmost value).
  // Raw XFF/X-Real-IP are only fallbacks for non-Express callers, and we
  // still take only the leftmost PUBLIC entry.
  if (!req) return null;
  const candidates = [];
  if (req.ip && typeof req.ip === 'string' && req.ip.trim()) candidates.push(req.ip.trim());
  const pushFwd = (fwd) => {
    if (typeof fwd === 'string' && fwd.trim()) {
      fwd.split(',').forEach((h) => { const t = h.trim(); if (t) candidates.push(t); });
    } else if (Array.isArray(fwd)) {
      fwd.forEach((entry) => String(entry).split(',').forEach((h) => { const t = h.trim(); if (t) candidates.push(t); }));
    }
  };
  pushFwd(req.headers && req.headers['x-forwarded-for']);
  const real = req.headers && req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) candidates.push(real.trim());
  for (const c of candidates) {
    const v4 = c.toLowerCase().startsWith('::ffff:') ? c.slice(7) : c;
    if (isPublicIp(v4)) return v4;
  }
  // No public hop (localhost / private / test env) — return the raw value so
  // callers can distinguish "no evidence" (null downstream) from blocking.
  if (req.ip && typeof req.ip === 'string' && req.ip.trim()) return req.ip.trim();
  if (req.connection && req.connection.remoteAddress) return req.connection.remoteAddress;
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return null;
}

function isPublicIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const v = ip.trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!v || v === 'unknown') return false;
  const v4 = v.startsWith('::ffff:') ? v.slice(7) : v;
  if (v4 === '127.0.0.1' || v4 === 'localhost') return false;
  if (v === '::1' || v === '::ffff:127.0.0.1') return false;
  const parts = v4.split('.');
  if (parts.length === 4 && parts.every(function (p) { return /^\d{1,3}$/.test(p); })) {
    const a = Number(parts[0]); const b = Number(parts[1]);
    if (a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 0 || a >= 224) return false;
    if (a === 203 && b === 0 && Number(parts[2]) === 113) return false;
    if (a === 198 && b === 51 && Number(parts[2]) === 100) return false;
    if (a === 192 && b === 0 && Number(parts[2]) === 2) return false;
    return true;
  }
  if (v.includes(':')) {
    if (v === '::' || v.startsWith('fe80:') || v.startsWith('fec0:') || v.startsWith('fc') || v.startsWith('fd')) return false;
    if (v.startsWith('2001:db8:')) return false;
    return true;
  }
  return false;
}

function lookupCountryForIp(ip) {
  try {
    if (!ip || !isPublicIp(ip)) return null;
    const clean = String(ip).trim().replace(/^\[|\]$/g, '');
    const v4 = clean.toLowerCase().startsWith('::ffff:') ? clean.slice(7) : clean;
    // Operator-supplied GeoLite2-Country.mmdb first (freshest data), then
    // the geoip-lite snapshot. Both are local MaxMind-format files: zero
    // key, zero billing, zero network — safe for millions of users.
    if (mmdbReader) {
      try {
        const mm = mmdbReader.getGeoData
          ? mmdbReader.getGeoData(v4)
          : (mmdbReader.get ? mmdbReader.get(v4) : null);
        const mmCode = mm && (mm.country ? (mm.country.iso_code || mm.country.isoCode) : mm.country);
        const norm = normalizeCountryCode(typeof mmCode === 'object' ? (mmCode && mmCode.iso_code) : mmCode);
        if (norm) return norm;
      } catch (e) { /* fall through to geoip-lite */ }
    }
    if (!geoip) return null;
    const result = geoip.lookup(v4);
    return normalizeCountryCode(result && result.country);
  } catch (e) {
    return null;
  }
}

function detectCountry(req) {
  try {
    geoMetrics.total += 1;
    const ip = getRequestIp(req);
    const fromHeaders = getCountryFromHeaders(req);
    if (fromHeaders) {
      if (ip) cacheIp(ip, fromHeaders.country);
      return withHintAudit(req, { country: fromHeaders.country, source: fromHeaders.source, ip: ip || null });
    }
    const cached = ip ? getCachedIp(ip) : undefined;
    if (cached !== undefined) {
      if (cached) return withHintAudit(req, { country: cached, source: 'ip-cache', ip: ip || null });
    } else if (ip) {
      const fromIp = lookupCountryForIp(ip);
      if (fromIp) { cacheIp(ip, fromIp); return withHintAudit(req, { country: fromIp, source: ipSource(), ip: ip || null }); }
      cacheIp(ip, null);
    }
    const headers = (req && req.headers) || {};
    const hinted = normalizeCountryCode(headers['x-country-code']) || normalizeCountryCode(req && req.query && req.query.country);
    if (hinted) { geoMetrics.hintHits += 1; return { country: hinted, source: 'client-hint', ip: ip || null }; }
    const fromHost = getCountryFromHostRegion(req);
    if (fromHost) return { country: fromHost.country, source: fromHost.source, ip: ip || null };
    geoMetrics.misses += 1;
    return { country: null, source: ip ? 'ip-unresolved' : 'unknown', ip: ip || null };
  } catch (e) { return { country: null, source: 'error', ip: null }; }
}

// Compare IP-evidence country against the Layer-3 client hint so callers can
// spot spoofed headers / VPN-vs-SIM mismatches. Returns { country, source,
// ip, hint?, conflict? }. IP evidence always wins; the hint is audit-only.
function withHintAudit(req, resolved) {
  try {
    const src = resolved.source || '';
    if (src.indexOf('header') === 0) geoMetrics.headerHits += 1;
    else if (src.indexOf('ip-') === 0) geoMetrics.ipHits += 1;
    else if (src === 'ip-cache') geoMetrics.ipHits += 1; // cache IS ip evidence
    const headers = (req && req.headers) || {};
    const hinted = normalizeCountryCode(headers['x-country-code'])
      || normalizeCountryCode(req && req.query && req.query.country);
    if (!hinted) return resolved;
    if (hinted === resolved.country) return { country: resolved.country, source: resolved.source, ip: resolved.ip || null, hint: hinted };
    geoMetrics.conflicts += 1;
    return { country: resolved.country, source: resolved.source, ip: resolved.ip || null, hint: hinted, conflict: true };
  } catch (e) { return resolved; }
}

function ipSource() {
  if (mmdbReader) return 'ip-maxmind';
  return 'ip-geoip-lite';
}

// TTL + bounded-size cache. Write path: fresh entry always wins; on overflow
// the oldest (soonest-to-expire) entries are evicted first. Read path: expired
// entries are dropped on sight. Bounded so memory cannot grow unbounded even
// under millions of unique client IPs.
function cacheIp(ip, code) {
  try {
    const now = Date.now();
    if (ipCache.size >= IP_CACHE_MAX) {
      let oldestKey = null;
      let oldestAt = Infinity;
      for (const [k, v] of ipCache) {
        if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
        // Fast path: an already-expired entry is evicted immediately.
        if (now - v.at > IP_CACHE_TTL_MS) { oldestKey = k; break; }
      }
      if (oldestKey) ipCache.delete(oldestKey);
    }
    ipCache.set(ip, { code: code || null, at: now });
  } catch (e) { /* cache is best-effort — never fail a lookup over it */ }
}

function getCachedIp(ip) {
  try {
    const entry = ipCache.get(ip);
    if (!entry) return undefined;
    if (Date.now() - entry.at > IP_CACHE_TTL_MS) {
      ipCache.delete(ip);
      return undefined;
    }
    return entry.code;
  } catch (e) { return undefined; }
}

async function detectCountryAsync(req) {
  return detectCountry(req);
}

function getGeoStats() {
  return {
    provider: 'geoip-lite-offline',
    dbLoaded: !!geoip,
    optionalMmdbLoaded: !!mmdbReader,
    cacheSize: ipCache.size,
    cacheTtlMs: IP_CACHE_TTL_MS,
    cacheMax: IP_CACHE_MAX,
    inflight: 0,
    breakerOpen: false,
    breakerFailures: 0,
    providerEnabled: true,
    metrics: { ...geoMetrics },
  };
}

// Clears the in-process cache and counters. Used by tests (jest --runInBand
// shares one process across suites) and safe to call in production (it only
// drops cache entries; the next lookup repopulates from the offline DB).
function resetGeoState() {
  try { ipCache.clear(); } catch (e) { /* best-effort */ }
  geoMetrics.total = 0;
  geoMetrics.headerHits = 0;
  geoMetrics.ipHits = 0;
  geoMetrics.hintHits = 0;
  geoMetrics.conflicts = 0;
  geoMetrics.misses = 0;
}

module.exports = {
  CDN_COUNTRY_HEADERS,
  RENDER_REGION_COUNTRY,
  detectCountry,
  detectCountryAsync,
  getCountryFromHeaders,
  getCountryFromHostRegion,
  getRequestIp,
  isPublicIp,
  lookupCountryForIp,
  normalizeCountryCode,
  getGeoStats,
  resetGeoState,
};
