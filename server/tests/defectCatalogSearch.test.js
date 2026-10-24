/**
 * Red tests proving defects in the catalog search and saved-search result
 * endpoints.
 *
 * DEFECT 1 — unescaped user input reaches MongoDB `$regex`.
 *   `GET /api/listings` embeds `search` and `brand` verbatim in `$regex`
 *   (routes/listings.js), while every other public search route
 *   (`/api/listings/search`, `/api/users/search`, `/api/admin/users`) escapes
 *   them with `escapeRegex`. Consequences:
 *     * a search containing a regex metacharacter (`(`, `[`, `*`, `+`, ...)
 *       makes MongoDB reject the pattern → 500 Server error instead of
 *       results (a bare "(" is a perfectly ordinary thing to type);
 *     * a search like `.*` is interpreted as a pattern and matches every
 *       listing instead of the literal text the user typed (filter
 *       injection), and a pathological input can pin the DB in catastrophic
 *       backtracking (ReDoS).
 *
 * DEFECT 2 — saved-search re-execution (`GET /api/saved-searches/:id/results`)
 * has the same unescaped `$regex` problem for `filters.brand` and the stored
 * query string.
 *
 * DEFECT 3 — saved-search results leak unpublished listings.
 *   The catalog (`GET /api/listings`) restricts to `status: 'active'`, but the
 *   saved-search query only filters `available`/`sold`/`quantity`. Draft
 *   listings default to available=true, sold=false, quantity=1, so a seller's
 *   DRAFT (hidden, never-published) listings show up in every buyer's saved
 *   search results.
 *
 * DEFECT 4 — `filters.sort = 'popular'` sorts on `'likes.length'`, a path the
 *   Listing schema does not have (`likesCount` is the maintained counter, and
 *   that is what the catalog and closet use). MongoDB treats the missing path
 *   as null for every document, so "most popular" returns natural/insertion
 *   order.
 *
 * DEFECT 5 — `PUT /api/saved-searches/:id` validates nothing, while POST
 *   validates every field. A non-numeric `filters.minPrice` is pushed into the
 *   schema and blows up as a CastError 500, and an out-of-enum
 *   `notifyFrequency` is persisted even though the schema declares an enum
 *   (findOneAndUpdate does not run validators by default).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');
const Listing = require('../models/Listing');
const SavedSearch = require('../models/SavedSearch');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let seller;
let sellerToken;

const makeListing = (overrides = {}) => Listing.create({
  seller: seller._id,
  title: 'Catalog Item',
  description: 'A listing used by the catalog search defect suite',
  price: 100,
  category: 'Men',
  condition: 'Good',
  quantity: 1,
  available: true,
  sold: false,
  status: 'active',
  shipsFrom: 'US',
  weight: 1,
  weightUnit: 'kg',
  images: [],
  ...overrides,
});

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  seller = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Defect Seller',
    email: `defect_catalog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  sellerToken = jwt.sign({ id: seller._id }, secret, { expiresIn: '1h' });

  await makeListing({ title: 'Alpha Jacket', description: 'Alpha description' });
});

afterAll(async () => {
  // jest.setup.js wipes the DB between files; only remove what this suite
  // explicitly created and owns.
  await SavedSearch.deleteMany({ user: seller._id });
});

describe('DEFECT 1: GET /api/listings must escape user regex input', () => {
  test('CS.1 a search string with a regex metacharacter does not 500', async () => {
    const res = await api.get('/api/listings').query({ search: '(' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.listings)).toBe(true);
  });

  test('CS.2 a brand filter with a regex metacharacter does not 500', async () => {
    const res = await api.get('/api/listings').query({ brand: '[abc' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.listings)).toBe(true);
  });

  test('CS.3 search treats regex metacharacters literally (no match-all injection)', async () => {
    const res = await api.get('/api/listings').query({ search: '.*' });
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(0);
  });

  test('CS.4 REGRESSION GUARD: plain substring search still finds listings', async () => {
    const res = await api.get('/api/listings').query({ search: 'Alpha' });
    expect(res.status).toBe(200);
    expect(res.body.listings.map((l) => l.title)).toContain('Alpha Jacket');
  });
});

describe('DEFECT 2 + 3 + 4 + 5: saved-search re-execution', () => {
  test('SS.1 a stored query with a regex metacharacter does not 500', async () => {
    const created = await api
      .post('/api/saved-searches')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Paren query', query: '(' });
    expect(created.status).toBe(201);

    const res = await api
      .get(`/api/saved-searches/${created.body._id}/results`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.listings)).toBe(true);
  });

  test('SS.2 a stored brand filter with a regex metacharacter does not 500', async () => {
    const created = await api
      .post('/api/saved-searches')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Bracket brand', query: '', filters: { brand: '[abc' } });
    expect(created.status).toBe(201);

    const res = await api
      .get(`/api/saved-searches/${created.body._id}/results`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.listings)).toBe(true);
  });

  test('SS.3 draft listings never appear in saved-search results', async () => {
    const marker = `DraftLeak${Date.now()}`;
    const draft = await makeListing({ title: `${marker} Draft`, status: 'draft' });
    const live = await makeListing({ title: `${marker} Live`, status: 'active' });

    const created = await api
      .post('/api/saved-searches')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Draft leak', query: marker });
    expect(created.status).toBe(201);

    const res = await api
      .get(`/api/saved-searches/${created.body._id}/results`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.listings.map((l) => String(l._id));
    expect(ids).toContain(String(live._id));
    expect(ids).not.toContain(String(draft._id));
  });

  test('SS.4 filters.sort=popular orders by likesCount, not insertion order', async () => {
    const marker = `Popularity${Date.now()}`;
    // Inserted first, lowest likes, newest — so natural order and the default
    // createdAt:-1 fallback both put it ABOVE the popular listing.
    const unpopularNew = await makeListing({
      title: `${marker} Unpopular New`,
      likesCount: 0,
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    const popularOld = await makeListing({
      title: `${marker} Popular Old`,
      likesCount: 25,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const created = await api
      .post('/api/saved-searches')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Popular', query: marker, filters: { sort: 'popular' } });
    expect(created.status).toBe(201);

    const res = await api
      .get(`/api/saved-searches/${created.body._id}/results`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.listings.map((l) => String(l._id));
    expect(ids.indexOf(String(popularOld._id))).toBeGreaterThan(-1);
    expect(ids.indexOf(String(popularOld._id)))
      .toBeLessThan(ids.indexOf(String(unpopularNew._id)));
  });

  test('SS.5 PUT rejects a non-numeric filters.minPrice with 400 (not a 500)', async () => {
    const created = await api
      .post('/api/saved-searches')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Update me', query: 'Alpha' });
    expect(created.status).toBe(201);

    const res = await api
      .put(`/api/saved-searches/${created.body._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ filters: { minPrice: 'abc' } });
    expect(res.status).toBe(400);
  });

  test('SS.6 PUT rejects an out-of-enum notifyFrequency with 400', async () => {
    const created = await api
      .post('/api/saved-searches')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Update me too', query: 'Alpha' });
    expect(created.status).toBe(201);

    const res = await api
      .put(`/api/saved-searches/${created.body._id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ notifyFrequency: 'sometimes' });
    expect(res.status).toBe(400);
  });
});
