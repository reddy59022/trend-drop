/*
 * R33 — TEST-HARNESS TRANSPORT ISOLATION
 *
 * The flake this file guards against
 * ---------------------------------
 * `supertest(app)` does NOT reuse a server: for every single request it runs
 *   app = http.createServer(app)      (supertest/lib/test.js)
 *   server.listen(0)                  -> a brand-new ephemeral port
 *   server.close()                    -> after the response
 *
 * A full `--runInBand` run issues tens of thousands of such requests, i.e. tens
 * of thousands of listen/close cycles over macOS' ~16k ephemeral port range, so
 * ports are recycled constantly. A recycled port can still carry TCP state from
 * the connection that used it a moment earlier, and the client then reads a
 * stream that is not the HTTP response it asked for. Observed as a RANDOM test
 * failing per run with a transport error rather than a product assertion:
 *
 *   "GET /api/users/me/tips?q[0]=x -> THREW Parse Error: Expected HTTP/, RTSP/ or ICE/"
 *   "POST /api/video-shopping/... -> THREW socket hang up"
 *
 * (both recorded in /tmp/jest-full.log and /tmp/npmtest.log; the suite passed in
 *  isolation and the failing route was different every run)
 *
 * The invariant asserted below is what removes that whole class: one file keeps
 * ONE listening server, so no port is ever churned or recycled mid-file.
 *
 * Before the fix these fail (every request reports a different port); after it
 * they pass. See jest.setup.js section 6 for the implementation.
 */
const request = require('supertest');
const app = require('../server');

// superagent records the concrete URL it hit, so the port is observable without
// reaching into supertest internals.
const portOf = (res) => {
  const url = res.request && res.request.url;
  return url ? new URL(url).port : null;
};

// Hostile query shapes — the exact family of requests that exposed the flake.
const HOSTILE_QUERIES = [
  '?q[$gt]=',
  '?q[0]=x',
  '?q[]=x',
  '?q=*)(.*',
  '?page[$gt]=1&limit=20',
  '?limit[$gt]=1',
  '?q=' + '*'.repeat(50),
];

const PUBLIC_PATHS = ['/health', '/api/listings', '/api/marketplace/countries'];

describe('R33 harness transport isolation', () => {
  it('R33.1 one test file reuses a single listening port', async () => {
    const ports = new Set();
    for (let i = 0; i < 15; i++) {
      const res = await request(app).get('/health');
      expect(res.status).toBeLessThan(500);
      ports.add(portOf(res));
    }
    // 15 requests, one port. Before the fix this set has 15 entries.
    expect([...ports]).toEqual([expect.any(String)]);
  });

  it('R33.2 concurrent requests share that port and all answer', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => request(app).get('/health'))
    );
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(new Set(results.map(portOf)).size).toBe(1);
  });

  it('R33.3 hostile queries can never produce a transport error', async () => {
    // A transport error (superagent reject) is the flake signature: the client
    // never received a well-formed HTTP response. Every probe must resolve.
    const probes = [];
    for (const path of PUBLIC_PATHS) {
      for (const qs of HOSTILE_QUERIES) {
        probes.push(path + qs);
      }
    }

    const thrown = [];
    const ports = new Set();
    for (const url of probes) {
      try {
        const res = await request(app).get(url);
        ports.add(portOf(res));
        expect(typeof res.status).toBe('number');
      } catch (err) {
        thrown.push(`${url} -> ${err.message}`);
      }
    }

    expect(thrown).toEqual([]);
    expect(ports.size).toBe(1);
  });

  it('R33.4 repeated suffixes on the same route stay on the same port', async () => {
    // Regression shape of the recorded failure: many variants of one route.
    const ports = new Set();
    for (let i = 0; i < 40; i++) {
      const res = await request(app).get('/api/listings' + HOSTILE_QUERIES[i % HOSTILE_QUERIES.length]);
      ports.add(portOf(res));
    }
    expect(ports.size).toBe(1);
  });
});
