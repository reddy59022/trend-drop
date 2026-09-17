// jest.setup.js — runs before every test file in the worker process
// (configured via jest.setupFilesAfterEnv).
//
// Responsibilities:
//   1. Point MONGODB_URI/MONGO_URI at the MongoMemoryServer started by
//      jest.globalSetup.js (URI handed off via a file, because env vars set
//      in globalSetup do not reach test workers). This MUST happen before
//      any test file `require('../server.js')`, whose module body calls
//      connectDB() — setupFilesAfterEnv runs before the test file module is
//      evaluated, which is what makes the ordering safe.
//   2. Keep the suite hermetic: replace global.fetch with a controllable
//      mock (Apple JWKS, Facebook /me, Brevo) and mock the email + Google
//      auth modules so no test ever touches the real network.
//   3. Clean the database between test files so suites never observe state
//      left behind by an earlier file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 1. Test database URI (memory server first, localhost as documented fallback)
// ---------------------------------------------------------------------------
const URI_FILE = path.join(__dirname, 'node_modules', '.cache', 'trenddrop-test-mongo-uri');

let TEST_MONGO_URI;
try {
  const cached = fs.readFileSync(URI_FILE, 'utf8').trim();
  if (cached) TEST_MONGO_URI = cached;
} catch (err) {
  // No memory-server handoff file; fall back to env/localhost below.
}

TEST_MONGO_URI =
  TEST_MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/trend-drop-test';

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'fallback_secret_change_me';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = TEST_MONGO_URI;
process.env.MONGO_URI = TEST_MONGO_URI;
// Skip Stripe SDK initialisation so test-confirm uses the global mock
// store path (no outbound calls to api.stripe.com in unit tests either).
process.env.SKIP_STRIPE_INIT = 'true';

// Disable Stripe for tests - use mock payment intents instead
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
// server.js calls dotenv.config() AFTER this file runs, and dotenv only sets
// vars that are absent — so a deleted var would be re-populated from
// server/.env (CHANGE_ME). Pin hermetic values instead of deleting.
// NOTE: Must NOT start with sk_test_/sk_live_ — we want the Stripe SDK
// uninitialised so test-confirm uses the global mock store path.
process.env.STRIPE_SECRET_KEY = 'trenddrop_hermetic';
process.env.STRIPE_WEBHOOK_SECRET = 'trenddrop_hermetic';

// ---------------------------------------------------------------------------
// 4. No retries — every test must pass on its FIRST attempt
// ---------------------------------------------------------------------------
// This used to be `jest.retryTimes(1, { logErrorsBeforeRetry: true })` to
// absorb a transport flake: roughly one request per full run died with
// "socket hang up" / "Parse Error: Expected HTTP/, RTSP/ or ICE/" in a
// DIFFERENT, unrelated test each run. Retrying is not a fix — it hides genuine
// regressions behind a second attempt and it makes "the suite is green" a much
// weaker statement than it looks.
//
// Root cause (see section 5): supertest created and closed a brand-new
// ephemeral server for every request, so a full run recycled macOS' ~16k
// ephemeral ports tens of thousands of times and the client could receive a
// stream that was never its own HTTP response. Section 6 fixes that at the
// source, so the retry is removed and R33 (harnessTransportIsolation.test.js)
// guards the invariant. Do NOT reintroduce a retry here: if a transport flake
// reappears, fix the harness instead.

// ---------------------------------------------------------------------------
// 5. Stable transport for supertest — one listening server per app per file
// ---------------------------------------------------------------------------
// `supertest(app)` creates a BRAND NEW server for EVERY request:
//
//   app = http.createServer(app);  app.listen(0);  ...  server.close()
//   (supertest/lib/test.js — constructor + Test#end)
//
// A full `--runInBand` run issues tens of thousands of requests, so it performs
// tens of thousands of ephemeral listen/close cycles over macOS' ~16k port
// range; ports are recycled almost immediately (measured: 15 sequential
// requests already reused a port). When the OS hands back a port whose previous
// connection still carries TCP state, the client can read a stream that is not
// its HTTP response and supertest rejects with a transport error instead of an
// assertion failure — which surfaced as a DIFFERENT random test failing per run:
//
//   ... -> THREW Parse Error: Expected HTTP/, RTSP/ or ICE/
//   ... -> THREW socket hang up
//
// Rather than paper over that with `jest.retryTimes()`, give each Express app
// ONE already-listening server for the lifetime of the test file. `listen(0)`
// binds synchronously, so `server.address()` is populated immediately and
// supertest sees a listening server: it neither creates another one nor closes
// it after each request. No ports are churned, so the failure class disappears
// and every test must still pass on its FIRST attempt.
// Regression coverage: tests/harnessTransportIsolation.test.js (R33).
jest.mock('supertest', () => {
  // jest.mock factories may only close over `mock*` names, so everything the
  // wrapper needs is required inside the factory.
  const actual = jest.requireActual('supertest');
  const http = require('http');

  const registry = global.__supertestHarnessServers ||
    (global.__supertestHarnessServers = []);
  const cache = new WeakMap();

  const serverFor = (app) => {
    // An already-listening Server (or a URL string) is passed through as-is;
    // only a bare Express app/handler needs the shared server.
    if (typeof app !== 'function') return app;

    let server = cache.get(app);
    if (!server) {
      server = http.createServer(app);
      server.listen(0); // synchronous bind — address() is ready for supertest
      cache.set(app, server);
      registry.push(server);
    }
    return server;
  };

  const supertest = (app, options) => actual(serverFor(app), options);
  supertest.agent = (app, options) => actual.agent(serverFor(app), options);
  supertest.Test = actual.Test;
  supertest.cookies = actual.cookies;
  return supertest;
});

// Release this file's harness servers once its tests are done. The registry is
// global because jest reuses one process (and one `global`) for every file in a
// `--runInBand` run, so it must be drained per file rather than at process exit.
afterAll(() => {
  const registry = global.__supertestHarnessServers;
  if (!Array.isArray(registry)) return;
  for (const server of registry.splice(0)) {
    try {
      server.close();
    } catch (err) {
      // Already closed — never fail the run because of cleanup.
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Stripe SDK mock (routes must never reach api.stripe.com in tests)
// ---------------------------------------------------------------------------
jest.mock('stripe', () => {
  // Shared in-memory store so create/retrieve/confirm/capture stay consistent.
  const intents = global.__mockPaymentIntents || (global.__mockPaymentIntents = {});
  const transfers = global.__mockTransfers || (global.__mockTransfers = {});

  const mockClient = {
    paymentIntents: {
      create: jest.fn(async (params) => {
        const id = `pi_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const intent = {
          id,
          object: 'payment_intent',
          status: 'requires_capture',
          amount: params?.amount ?? 0,
          currency: params?.currency ?? 'usd',
          metadata: params?.metadata ?? {},
          client_secret: `cs_${id}_secret`,
          ...params,
        };
        intents[id] = intent;
        return intent;
      }),
      retrieve: jest.fn(async (id) => {
        const found = intents[id];
        if (!found) {
          const err = new Error('No such payment intent');
          err.code = 'resource_missing';
          throw err;
        }
        return { ...found };
      }),
      confirm: jest.fn(async (id, params) => {
        const found = intents[id];
        if (!found) {
          const err = new Error('No such payment intent');
          err.code = 'resource_missing';
          throw err;
        }
        const updated = { ...found, status: 'succeeded', ...params };
        intents[id] = updated;
        return updated;
      }),
      capture: jest.fn(async (id) => {
        const found = intents[id];
        if (!found) {
          const err = new Error('No such payment intent');
          err.code = 'resource_missing';
          throw err;
        }
        const updated = { ...found, status: 'succeeded' };
        intents[id] = updated;
        return updated;
      }),
    },
    checkout: {
      sessions: {
        create: jest.fn(async (params) => ({
          id: `cs_test_${Date.now()}`,
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/test',
          ...params,
        })),
        retrieve: jest.fn(async (id) => ({ id, object: 'checkout.session' })),
      },
    },
    transfers: {
      create: jest.fn(async (params) => ({ id: `tr_test_${Date.now()}`, object: 'transfer', ...params })),
    },
    payouts: {
      create: jest.fn(async (params) => ({
        id: `po_test_${Date.now()}`,
        object: 'payout',
        status: 'pending',
        ...params,
      })),
      retrieve: jest.fn(async (id) => ({ id, object: 'payout', status: 'paid' })),
    },
    balance: {
      retrieve: jest.fn(async () => ({
        available: [{ amount: 0, currency: 'usd' }],
        pending: [{ amount: 0, currency: 'usd' }],
      })),
    },
    customers: {
      create: jest.fn(async (params) => ({ id: 'cus_test_1', ...params })),
    },
    accounts: {
      create: jest.fn(async () => ({ id: 'acct_test_1' })),
      retrieve: jest.fn(async (id) => ({ id: id || 'acct_test_1' })),
    },
    webhooks: {
      constructEvent: jest.fn((payload, sig) => {
        // Fail-closed mock: mirrors the real Stripe SDK contract closely
        // enough to catch missing/empty signatures at the unit level. The
        // production verifier rejects empty sigs before reaching here, but
        // defense in depth: never let an empty signature construct an event.
        if (!sig || (typeof sig === 'string' && !sig.trim()) || sig === 'bad') {
          throw new Error(!sig || !String(sig).trim() ? 'Missing Stripe-Signature header' : 'Invalid signature');
        }
        if (Buffer.isBuffer(payload)) {
          return JSON.parse(payload.toString());
        }
        return typeof payload === 'string' ? JSON.parse(payload) : payload;
      }),
    },
  };
  return jest.fn(() => mockClient);
});

// Pin Cloudinary to hermetic values so server/.env real keys never re-populate
// (server.js calls dotenv.config() after this file runs; dotenv only sets
// absent vars, so pinning beats deleting). Tests must never reach
// res.cloudinary.com — mocked below.
process.env.CLOUDINARY_CLOUD_NAME = 'trenddrop-test';
process.env.CLOUDINARY_API_KEY = 'test_key';
process.env.CLOUDINARY_API_SECRET = 'test_secret';

// Mock the Cloudinary SDK entirely: uploads, streams (multer-storage-cloudinary
// pipes file.stream into uploader.upload_stream), and destroys are all
// in-memory with deterministic public URLs.
jest.mock('cloudinary', () => {
  const { PassThrough } = require('stream');
  const publicUrl = (publicId) =>
    `https://res.cloudinary.com/trenddrop-test/image/upload/v1/${publicId}.webp`;
  const mockUploader = {
    upload: jest.fn(async (file, options = {}) => {
      const publicId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        public_id: publicId,
        secure_url: publicUrl(publicId),
        url: publicUrl(publicId).replace('https://', 'http://'),
        format: 'webp',
        width: 800,
        height: 800,
        bytes: 1234,
        created_at: new Date().toISOString(),
      };
    }),
    destroy: jest.fn(async (publicId) => ({ result: 'ok', public_id: publicId })),
    upload_stream: jest.fn((options, callback) => {
      const stream = new PassThrough();
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const publicId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        callback(null, {
          public_id: publicId,
          secure_url: publicUrl(publicId),
          url: publicUrl(publicId).replace('https://', 'http://'),
          format: 'webp',
          bytes: Buffer.concat(chunks).length,
        });
      });
      return stream;
    }),
  };
  return {
    v2: {
      config: jest.fn(),
      uploader: mockUploader,
      api: { resources: jest.fn(async () => ({ resources: [] })) },
    },
  };
});

// ---------------------------------------------------------------------------
// 2. Hermetic external calls
// ---------------------------------------------------------------------------

// 2a. Brevo transactional email — never send real email from tests.
jest.mock('./config/email', () => ({
  sendVerificationEmail: jest.fn(async () => true),
  sendPasswordResetEmail: jest.fn(async () => true),
}));

// 2b. Google OAuth — google-auth-library's verifyIdToken() fetches Google's
// certificate endpoint over the network. Provide a canned verified payload.
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(async () => ({
      getPayload: () => ({
        sub: 'google_test_sub_123',
        email: 'google_test@example.com',
        name: 'Google Test User',
        picture: 'https://example.com/google-avatar.png',
      }),
    })),
  })),
}));

// 2c. Push transports (TD-2.3) — never touch FCM/APNs from tests. The
// transport module is key-gated in production (no credentials → skip); tests
// replace the senders with recording mocks so pushService routing, preference
// gating, and event hooks are exercised end-to-end.
jest.mock('./services/pushTransports', () => ({
  sendFcm: jest.fn(async () => ({ ok: true, provider: 'fcm', messageId: 'test-fcm-msg' })),
  sendApns: jest.fn(async () => ({ ok: true, provider: 'apns' })),
}));

// 2c. global.fetch — the Apple / Facebook OAuth flows call real external APIs
// in production. In tests, intercept every request with controlled responses:
//   * Apple JWKS endpoint → a test JWK whose public key verifies identity
//     tokens signed with the paired test private key (see global.testJwt).
//   * Facebook Graph /me → a fixed test identity.
//   * Brevo API → 200 so any fetch-based email delivery succeeds.
//   * Anything else → 200 with `{ ok: true }` (fail loudly per-test by
//     overriding with fetchMock.mockImplementationOnce(...) if needed).
const APPLE_KID = 'trenddrop-test-key';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// The RSA test keypair is generated ONCE in jest.globalSetup.js and handed
// off via the cache dir (next to the Mongo URI file). Generating an RSA-2048
// pair here in every test file used to cost ~100ms x ~140 files per run.
// Fall back to generating locally when the cache file is absent (e.g. a bare
// setup run that skipped globalSetup) so suites always have a working pair.
const KEYS_FILE = path.join(__dirname, 'node_modules', '.cache', 'trenddrop-test-jwt-keys.json');

let privateKey;
let publicKey;
let publicJwk;
try {
  privateKey = crypto.createPrivateKey(JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')).privateKeyPem);
  publicKey = crypto.createPublicKey(privateKey);
  publicJwk = publicKey.export({ format: 'jwk' });
} catch (err) {
  ({ privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  }));
  publicJwk = publicKey.export({ format: 'jwk' });
}
const APPLE_JWK = {
  kty: 'RSA',
  kid: APPLE_KID,
  use: 'sig',
  alg: 'RS256',
  n: publicJwk.n,
  e: publicJwk.e,
};

const fetchMock = jest.fn(async (url) => {
  const u = String(url);
  if (u.includes('appleid.apple.com/auth/keys')) {
    return jsonResponse({ keys: [APPLE_JWK] });
  }
  if (u.includes('graph.facebook.com')) {
    return jsonResponse({
      id: 'fb_test_id_123',
      email: 'facebook_test@example.com',
      name: 'Facebook Test User',
      picture: { data: { url: 'https://example.com/fb-avatar.png' } },
    });
  }
  if (u.includes('brevo.com') || u.includes('sendinblue.com')) {
    return jsonResponse({ messageId: 'mocked-test-message-id' });
  }
  return jsonResponse({ ok: true });
});

global.fetch = fetchMock;
global.fetchMock = fetchMock; // suites can override per-call with mockResolvedValueOnce

// Keep social-login tests hermetic: a real app/client id loaded from
// server/.env must not change token-verification behavior in tests.
delete process.env.APPLE_CLIENT_ID;
delete process.env.FB_APP_ID;
delete process.env.FB_APP_SECRET;

global.testJwt = {
  /** Sign an Apple identity token with the key paired to the mocked JWKS. */
  signAppleIdentityToken: (payload) =>
    require('jsonwebtoken').sign(
      { iss: 'https://appleid.apple.com', aud: 'com.trenddrop.test', ...payload },
      privateKey,
      { algorithm: 'RS256', header: { kid: APPLE_KID } }
    ),
};

// ---------------------------------------------------------------------------
// 3. Clean the DB between test files (runs after the last test of each file)
// ---------------------------------------------------------------------------
// Registered here (setupFilesAfterEnv), this afterAll executes once per test
// file, after that file's own hooks, so suites start every file with an empty
// database regardless of what earlier files left behind. deleteMany (rather
// than dropDatabase) keeps indexes intact so suites don't pay rebuild costs.
afterAll(async () => {
  const mongoose = require('mongoose');
  if (mongoose.connection.readyState === 0 || !mongoose.connection.db) return;
  try {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  } catch (err) {
    // Never fail the run because of cleanup; the next file connects fresh.
  }
});
