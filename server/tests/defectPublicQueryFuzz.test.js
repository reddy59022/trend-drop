/**
 * Hostile-query sweep over the PUBLIC read surface.
 *
 * Every one of these endpoints is reachable without a session, so any input
 * shape a browser can produce is fair game. The contract is the same as the
 * body-id sweep: a garbage query parameter is a 4xx, never a 5xx. Numeric
 * coercion (`Number('abc')` -> NaN, `parseInt('1e999')` -> 1, unbounded
 * `limit`), raw `$regex` embedding and Mongoose casting are the usual ways a
 * 500 sneaks in.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const api = request(app);

const QUERIES = [
  '?limit=abc',
  '?limit=-5',
  '?limit=1e999',
  '?limit=999999999999999999999',
  '?page=abc',
  '?page=-1',
  '?page=0',
  '?offset=NaN',
  '?sort=not_a_field',
  '?q=(',
  '?q=[a-',
  '?q=.*',
  '?search=(',
  '?search=.*',
  '?category[$ne]=1',
  '?minPrice=abc',
  '?maxPrice=-1',
  '?price[$gt]=0',
  '?lat=abc&lng=abc',
  '?radius=Infinity',
  '?brand=(',
  '?size=1e999',
];

const PATHS = [
  '/api/listings',
  '/api/listings/search',
  '/api/users/search',
  '/api/trends',
  '/api/trends/forecast',
  '/api/size-guides',
  '/api/size-guides/Women',
  '/api/comments/trending',
  '/api/live-events/upcoming',
  '/api/video-shopping/public',
  '/api/parties',
  '/api/marketplace/countries',
  '/api/shipping/tracking-statuses',
  '/api/features',
  '/api/feed',
  '/api/recently-viewed',
];

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('public read endpoints survive hostile query strings', () => {
  for (const path of PATHS) {
    test(`${path} never answers 5xx`, async () => {
      const failures = [];
      for (const qs of QUERIES) {
        // eslint-disable-next-line no-await-in-loop
        const res = await api.get(`${path}${qs}`);
        if (res.status >= 500) {
          failures.push(`${qs} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
        }
      }
      expect(failures).toEqual([]);
    }, 60000);
  }
});
