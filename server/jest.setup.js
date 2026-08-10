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

// Disable Stripe for tests - use mock payment intents instead
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
// server.js calls dotenv.config() AFTER this file runs, and dotenv only sets
// vars that are absent — so a deleted var would be re-populated from
// server/.env (CHANGE_ME). Pin hermetic values instead of deleting.
process.env.STRIPE_SECRET_KEY = 'sk_test_trenddrop_hermetic';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_trenddrop_hermetic';

// Mock the Stripe SDK entirely: routes must never reach api.stripe.com.
jest.mock('stripe', () => {
  const mockClient = {
    paymentIntents: {
      create: jest.fn(async (params) => ({
        id: `pi_test_${Date.now()}`,
        object: 'payment_intent',
        status: 'requires_confirmation',
        ...params,
      })),
      confirm: jest.fn(async (id, params) => ({
        id: typeof id === 'string' ? id : id && id.id,
        object: 'payment_intent',
        status: 'succeeded',
        ...(params || {}),
      })),
      retrieve: jest.fn(async (id) => ({ id, object: 'payment_intent', status: 'succeeded' })),
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
        if (sig === 'bad') throw new Error('Invalid signature');
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

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
// NOTE: Node 24 rejects createPublicKey(publicKey) with
// "Invalid key object type public, expected private", so export directly.
const publicJwk = publicKey.export({ format: 'jwk' });
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
