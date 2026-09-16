/* TDD Round 21 — RUNTIME ROUTER-STACK SWEEP (self-maintaining audit).
 *
 * Round 20 walked the surface with a hand-written probe table. A hand-written
 * table can only audit the endpoints someone remembered to list, so the moment
 * a new route is mounted it is silently unaudited. This round removes the
 * human from the loop: the route inventory is read out of the LIVE Express
 * router stack at run time, so every mounted route is probed automatically and
 * a newly added route is covered the day it is added.
 *
 * Invariant (same as R20): no route under /api may answer 5xx to hostile-but-
 * well-formed input. 400/401/403/404/409/422/429 are correct rejections; a 500
 * is an unhandled crash.
 *
 *   R21.2 authed + hostile bodies -> no 5xx anywhere
 *   R21.3 authed GET + hostile query strings -> no 5xx anywhere
 *   R21.4 unauthenticated -> no 5xx anywhere
 *
 * Requests run as an ADMIN (so admin-only routes are reached rather than
 * short-circuited with 403) and the suite is hermetic: jest.setup.js already
 * mocks global.fetch, the mailer, Google/Apple auth and push transports, so no
 * probe touches the real network.
 *
 * /tmp/r21-sweep.tsv holds the full method/path/status matrix of the last run.
 */
const fs = require('fs');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');

jest.setTimeout(900000);

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r21_${Date.now()}`;
const GHOST = () => new mongoose.Types.ObjectId().toString();

// ---------------------------------------------------------------------------
// Route inventory, read from the live Express router stack
// ---------------------------------------------------------------------------
// A mounted router layer keeps its mount prefix in layer.regexp, e.g.
// /^\/api\/auth\/?(?=\/|$)/i for app.use('/api/auth', router) -> '/api/auth'.
const mountPath = (layer) => {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const src = (layer.regexp && layer.regexp.source) || '';
  return src
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/');
};

// Recursively walks routers (including nested router.use() mounts) and returns
// one entry per (method, full path). App-level middleware layers (helmet, cors,
// json parser, assertObjectId, ...) have neither a route nor a router stack and
// are skipped.
const collectRoutes = (router) => {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const full = (prefix + layer.route.path).replace(/\/+$/, '') || '/';
        for (const m of Object.keys(layer.route.methods || {})) {
          out.push({ method: m.toUpperCase(), path: full });
        }
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };
  walk(router && router.stack, '');
  // De-duplicate (the same path can be mounted twice, e.g. bulkListings then
  // listings under /api/listings) while keeping first-seen order.
  const seen = new Set();
  return out.filter((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ---------------------------------------------------------------------------
// Hostile inputs
// ---------------------------------------------------------------------------
// One shotgun body exercising the wrong-type/missing-field class across the
// field names this codebase actually uses, instead of guessing per-endpoint.
const SHOTGUN = {
  id: 123, listingId: 123, sellerId: {}, buyerId: [], offerId: 123,
  transactionId: 123, orderId: 123, productId: 123, promoId: 123,
  code: 123, status: 123, sessionType: 123, role: {}, type: [],
  quantity: 'five', price: 'free', amount: {}, total: 'x', rating: 'high',
  stars: {}, page: 'x', limit: -1, email: 123, country: 123, currency: 123,
  items: 'nope', measurements: 'nope', shippingPartners: 'nope',
  name: 42, title: {}, message: [], reason: 42, metadata: 'str',
  address: 'nope', dates: 'nope', images: 'nope', tags: 'nope',
};

// Credential-shaped body: the auth routes guard with truthiness (`!email`), so
// a truthy-but-wrong-typed credential slips past and reaches string methods
// such as .toLowerCase() / .length. This body is what makes that class of bug
// visible (SHOTGUN alone missed it by never sending `password`).
const CREDS = {
  name: 42, email: 123, password: 123, newPassword: 123, currentPassword: {},
  confirmPassword: [], token: {}, code: 123, username: 42, phone: {},
};

// Oversized body: schema maxlength failures are ValidationErrors thrown from
// save(), which also surface as 500s and are invisible to a type-only sweep.
const OVERSIZED = {
  name: 'x'.repeat(300), title: 'y'.repeat(300), bio: 'z'.repeat(900),
  description: 'd'.repeat(900), country: 'USA', currency: 'USDD',
  code: 'c'.repeat(200), message: 'm'.repeat(900), email: `${'e'.repeat(300)}@t.co`,
  category: 'k'.repeat(200), reason: 'r'.repeat(900), nickname: 'n'.repeat(300),
  slug: 's'.repeat(300), url: `https://x.co/${'u'.repeat(900)}`,
  price: '9'.repeat(60), quantity: 99999999999,
};

// Nullish body: explicit nulls on required paths pass truthiness checks but
// throw a required-validation error on save.
const NULLISH = {
  name: null, title: null, description: null, code: null, email: null,
  price: null, quantity: null, items: null, measurements: null,
  shippingPartners: null, status: null, category: null, address: null,
  token: null, password: null, rating: null,
};

// ---------------------------------------------------------------------------
// Hostile payloads: they simulate a client that ignores (or attacks) the API
// contract — wrong types, null-prototype objects, giant strings, NoSQL
// operator keys — without being malformed HTTP (every entry JSON-encodes and
// stays well under the body-size limit).
// ---------------------------------------------------------------------------
const HOSTILE_QUERY_STRINGS = [
  '',                                        // bare path
  '?q[$gt]=',                                // NoSQL operator injection
  '?q[$ne]=x',
  '?q[0]=x',                                 // array-shaped value
  '?q[]=x',
  '?q=',                                     // empty string
  '?q=' + '*'.repeat(50),                    // hostile regex metacharacters
  '?limit[$gt]=1',
  '?limit[]=20',
  '?page[$gt]=1',
  '?sort[$gt]=1',
  '?minPrice[$gt]=1&maxPrice[$lt]=999999',
  '?category[$gt]=x',
  '?search[$gt]=x',
  '?__proto__[polluted]=1',                  // prototype pollution attempt
];

// Appends a hostile query string to a concrete URL. `%3A`-style encoded path
// params are left untouched; only the query string is varied.
const withQuery = (url, qs) => (qs ? url + (url.includes('?') ? '&' + qs.slice(1) : qs) : url);

const HOSTILE_BODIES = [
  {},                          // every field missing
  { __hostile: 'x', nope: 1 }, // unknown fields only
  SHOTGUN,                     // wrong types across the board
  CREDS,                       // truthy but wrong-typed credentials
  OVERSIZED,                   // schema maxlength violations
  NULLISH,                     // explicit nulls on required paths
  [1, 2, 3],                   // array where an object is expected
];

// Substitute path params: *Id-style params get a well-formed ghost ObjectId (so
// the global assertObjectId lets the request through to the handler), anything
// else gets a ghost string.
const urlFor = (path) => path.replace(/:([A-Za-z0-9_]+)/g, (_, name) =>
  (/Id$|^id$/i.test(name) ? GHOST() : `ghost-${String(name).toLowerCase()}`));

// `token[]=1` is the query-string equivalent of a wrong-typed body field: the
// extended query parser turns it into an array, which routes that pass it to a
// String schema path then CastError on.
const QUERY = '?page=abc&limit=-1&status=__proto__&sort=-&token[]=1&email[]=1';

// Routes that destroy the sweep's own fixture. DELETE /api/auth/account removes
// the very user the token points at, after which EVERY later authed probe 401s
// and the sweep silently stops testing anything (1378 of 1603 probes went
// vacuous before this list existed). Excluded here; R21.4 covers it directly.
const HARNESS_DESTROYING = new Set(['DELETE /api/auth/account']);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const all = [];        // every probe of the whole file, for the TSV artifact
const U = [];
const L = [];
let me;
let token;
let listing;

const US = { fullName: 'R21', street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' };

const call = (method, url, { body, auth = true } = {}) => {
  const r = request(app)[method.toLowerCase()](url);
  if (auth) r.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) r.send(body);
  return r;
};

// Runs every hostile body against every route and returns the probe records.
// A rejected promise counts as a crash too: supertest rejects when the app
// throws without ever sending a response, which is exactly the 5xx class we
// are auditing for.
const sweep = async (routes, { auth, bodiesFor }) => {
  const out = [];
  for (const route of routes) {
    if (HARNESS_DESTROYING.has(`${route.method} ${route.path}`)) continue;
    const url = urlFor(route.path) + (route.method === 'GET' ? QUERY : '');
    for (const body of bodiesFor(route)) {
      let res;
      try {
        res = await call(route.method, url, { body, auth });
      } catch (err) {
        out.push({ method: route.method, url, body, status: 'THREW', msg: err.message });
        continue;
      }
      out.push({
        method: route.method,
        url,
        body,
        status: res.status,
        msg: (res.body && res.body.message) || '',
      });
    }
  }
  all.push(...out);
  return out;
};

// The assertion payload: anything 5xx (or an outright throw) is a bug.
const crashes = (probes) => probes
  .filter((p) => p.status === 'THREW' || Number(p.status) >= 500)
  .map((p) => `${p.method} ${p.url} :: body=${JSON.stringify(p.body)} -> ${p.status} ${p.msg}`);

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  me = await User.create({
    name: 'R21 Admin', email: `${RUN}_admin@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    role: 'admin', shippingAddress: { ...US },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  U.push(me._id);
  token = jwt.sign({ id: me._id }, SECRET, { expiresIn: '30d' });
  listing = await Listing.create({
    seller: me._id, title: 'R21 Item', description: 'd', price: 50,
    category: 'Men', condition: 'New with tags', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5,
  });
  L.push(listing._id);
});

afterAll(async () => {
  // Always emit the full matrix, even when an assertion above failed, so a red
  // run is triageable without re-running the sweep.
  fs.writeFileSync(
    '/tmp/r21-sweep.tsv',
    all.map((p) => `${p.method}\t${p.url}\t${p.status}\t${p.msg}`).join('\n') + '\n'
  );
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});

describe('R21 runtime router-stack sweep', () => {
  let routes;

  beforeAll(() => {
    routes = collectRoutes(app._router);
    fs.writeFileSync('/tmp/r21-routes.json', JSON.stringify(routes, null, 1));
  });

  it('R21.1 discovers the whole mounted surface from the live router stack', () => {
    // Guards against the inventory silently collapsing to nothing (which would
    // make every assertion below vacuously pass).
    expect(routes.length).toBeGreaterThan(300);
    expect(routes.some((r) => r.method === 'POST' && r.path === '/api/promos/validate')).toBe(true);
    expect(routes.every((r) => r.path.startsWith('/'))).toBe(true);
  });

  it('R21.2 authed + hostile bodies -> no 5xx anywhere', async () => {
    const probes = await sweep(routes, {
      auth: true,
      bodiesFor: (r) => (['GET', 'HEAD', 'DELETE'].includes(r.method) ? [undefined] : HOSTILE_BODIES),
    });
    expect(probes.length).toBeGreaterThan(300);
    expect(crashes(probes)).toEqual([]);
    // Canary: the token must STILL authenticate after the sweep. Without this,
    // a route that destroys the fixture user (or the token) would turn every
    // probe after it into a vacuous 401 and the suite would still look green.
    const canary = await call('GET', '/api/auth/me');
    expect(canary.status).toBe(200);
  });

  it('R21.3 authed GET + hostile query strings -> no 5xx anywhere', async () => {
    // Express' extended query parser turns ?q[$gt]= / ?q[]=x into objects and
    // arrays on req.query; routes that forward those into Mongoose ($regex,
    // numeric filters, skip/limit) CastError -> 500. Every GET route gets each
    // hostile query string appended to its concrete URL.
    const gets = routes.filter((r) => r.method === 'GET');
    expect(gets.length).toBeGreaterThan(100);
    const out = [];
    for (const route of gets) {
      const base = urlFor(route.path);
      for (const qs of HOSTILE_QUERY_STRINGS) {
        const url = withQuery(base, qs);
        let res;
        try {
          res = await call(route.method, url);
        } catch (err) {
          out.push({ method: route.method, url, body: undefined, status: 'THREW', msg: err.message });
          continue;
        }
        out.push({
          method: route.method,
          url,
          body: undefined,
          status: res.status,
          msg: (res.body && res.body.message) || '',
        });
      }
    }
    all.push(...out);
    expect(crashes(out)).toEqual([]);
  });

  it('R21.4 unauthenticated -> no 5xx anywhere', async () => {
    const probes = await sweep(routes, {
      auth: false,
      bodiesFor: (r) => (['GET', 'HEAD', 'DELETE'].includes(r.method) ? [undefined] : [{}]),
    });
    expect(crashes(probes)).toEqual([]);
  });
});
