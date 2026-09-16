/* TDD Round 22 — HOSTILE QUERY-SHAPE SWEEP (complements R21 body sweep). */
const fs = require('fs');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');

jest.setTimeout(900000);

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r22_${Date.now()}`;
const GHOST = () => new mongoose.Types.ObjectId().toString();

// ---------------------------------------------------------------------------
// Route inventory, read from the live Express router stack (same as R21)
// ---------------------------------------------------------------------------
const mountPath = (layer) => {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const src = (layer.regexp && layer.regexp.source) || '';
  return src
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/');
};

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
  const seen = new Set();
  return out.filter((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Concrete ghost ObjectId for every :param segment (assertObjectId 400s
// anything else, so invalid ids are already covered by the 400 path).
const fillParams = (path) => path.replace(/:[A-Za-z0-9_]+/g, () => GHOST());

// Hostile query shapes: extended (?a[$gt]=), indexed (?a[0]=), array
// (?a[]=), scalar junk, empties, and a regex-DoS attempt.
const QUERY_SHAPES = [
  '',
  '?q[$gt]=',
  '?q[0]=x',
  '?q[]=x',
  '?q=*',
  '?q=*)(.*',
  '?page[$gt]=1&limit=20',
  '?page=1&limit[$gt]=1',
  '?page=abc&limit=-99',
  '?page[]=1&limit[]=20',
  '?limit[$gt]=1',
  '?limit=abc',
  '?limit[]=20',
  '?minPrice[$gt]=1',
  '?maxPrice[$gt]=1',
  '?search[$gt]=x',
  '?search[]=x',
  '?category[$gt]=x',
  '?brand[]=x',
  '?sort[]=price_low',
  '?status[$gt]=x',
  '?role[]=admin',
  '?timeframe[$gt]=x',
  '?country[$gt]=x',
];

// ---------------------------------------------------------------------------
let me;
let token;
const U = [];
const all = [];
const crashes = (probes) => probes
  .filter((p) => p.status === 'THREW' || Number(p.status) >= 500)
  .map((p) => `${p.method} ${p.url} -> ${p.status} ${p.msg}`);

const sweepQueries = async (routes, { auth }) => {
  const out = [];
  const agent = request(app);
  for (const route of routes) {
    const base = fillParams(route.path);
    for (const qs of QUERY_SHAPES) {
      const url = base + qs;
      let res;
      try {
        let req = agent.get(url);
        if (auth) req = req.set('Authorization', `Bearer ${token}`);
        res = await req;
      } catch (err) {
        out.push({ method: 'GET', url, status: 'THREW', msg: err.message });
        continue;
      }
      out.push({
        method: 'GET',
        url,
        status: res.status,
        msg: (res.body && res.body.message) || '',
      });
    }
  }
  all.push(...out);
  return out;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  me = await User.create({
    name: 'R22 Admin', email: `${RUN}_admin@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    role: 'admin',
  });
  U.push(me._id);
  token = jwt.sign({ id: me._id }, SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  fs.writeFileSync(
    '/tmp/r22-sweep.tsv',
    all.map((p) => `${p.method}\t${p.url}\t${p.status}\t${p.msg}`).join('\n') + '\n'
  );
  await User.deleteMany({ _id: { $in: U } });
});

describe('R22 hostile query-shape sweep', () => {
  let routes;

  beforeAll(() => {
    routes = collectRoutes(app._router).filter((r) => r.method === 'GET');
    fs.writeFileSync('/tmp/r22-routes.json', JSON.stringify(routes, null, 1));
  });

  it('R22.1 inventories every mounted GET route', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.some((r) => r.path === '/api/users/search')).toBe(true);
    expect(routes.every((r) => r.path.startsWith('/'))).toBe(true);
  });

  it('R22.2 authed hostile queries no 5xx', async () => {
    const probes = await sweepQueries(routes, { auth: true });
    expect(probes.length).toBeGreaterThan(100);
    expect(crashes(probes)).toEqual([]);
    const canary = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(canary.status).toBe(200);
  });

  it('R22.3 unauth hostile queries no 5xx', async () => {
    const probes = await sweepQueries(routes, { auth: false });
    expect(crashes(probes)).toEqual([]);
  });

  it('R22.4 spot checks degrade gracefully', async () => {
    const A = `Bearer ${token}`;
    let r = await request(app).get('/api/users/search?q[$gt]=').set('Authorization', A);
    expect(r.status).not.toBeGreaterThanOrEqual(500);
    r = await request(app).get('/api/listings?minPrice[$gt]=1').set('Authorization', A);
    expect(r.status).not.toBeGreaterThanOrEqual(500);
    r = await request(app).get('/api/users/search').query({ q: ['a', 'b'] }).set('Authorization', A);
    expect(r.status).not.toBeGreaterThanOrEqual(500);
    r = await request(app).get('/api/users/search').query({ q: '*)(.*' }).set('Authorization', A);
    expect(r.status).not.toBeGreaterThanOrEqual(500);
    r = await request(app).get('/api/users/feed?page=abc&limit=-99').set('Authorization', A);
    expect(r.status).toBe(200);
  });
});