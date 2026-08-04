// jest.setup.js — runs before every test file in the worker process
// (configured via jest.setupFilesAfterEnv).
//
// Gives each test SUITE a stable, shared test database and prevents the
// "Can't call openUri() on an active connection with different connection
// strings" crash that occurs when Jest reuses a worker process across test
// files that connect to different Mongo URIs.
//
// Some test files previously fell back to
//   process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test'
// which pointed at a DIFFERENT database name than the configured
// 'trend-drop-test'. When run via plain `npx jest` (instead of `npm test`,
// which sets both env vars), those suites connected to a different URI and
// crashed the shared Mongoose connection. Pinning BOTH env vars here ensures
// every suite (and the app under test) always uses the same database,
// regardless of how the test runner is invoked.

const TEST_MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/trend-drop-test';

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'fallback_secret_change_me';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = TEST_MONGO_URI;
process.env.MONGO_URI = TEST_MONGO_URI;

// Disable Stripe for tests - use mock payment intents instead
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

// NOTE: We intentionally do NOT disconnect Mongoose after each file here.
// Several suites (e.g. offers.test.js) execute top-level DB operations at
// module evaluation time, so a cross-file disconnect crashes those suites.
// The connectDB() helper in config/db.js already honors an active connection
// and reconnects when readyState is 0, which together with the pinned,
// consistent URI above eliminates the "Can't call openUri() on an active
// connection" crash without tearing the connection down between files.
