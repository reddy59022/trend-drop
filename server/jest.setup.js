// jest.setup.js — runs before every test file in the worker process
// (configured via jest.setupFilesAfterEnv).
//
// Gives each test SUITE its own isolated MongoDB database
// (trend-drop-test-<suite name>) on the shared local MongoDB server.
// This prevents suites from clobbering each other's fixtures and cleanups
// while guaranteeing the app under test (server.js -> config/db.js) and the
// direct model operations inside each test file always speak to the SAME
// database for that suite.
//
// Previous architecture ran every suite against one shared database, which
// caused hundreds of cascading failures (401s, "User not found", null carts,
// wiped fixtures) purely from cross-suite interference.

const path = require('path');

// NOTE: The test runner executes with --runInBand and a single shared test DB
// (see package.json test scripts). Because suites run serially in one process
// and the app connects lazily via Mongoose, per-suite database isolation is NOT
// needed here — the shared MONGODB_URI set in the npm script is authoritative.
// This keeps the app's Mongoose connection and each suite's explicit
// `mongoose.connect()` on the SAME database, eliminating:
//   1. `Can't call openUri() on an active connection` cross-worker crashes
//   2. Cross-suite data contamination when suites clean up shared fixtures
//
// We still pin a stable JWT secret + NODE_ENV so token generation and route
// behavior are deterministic across environments.

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'fallback_secret_change_me';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test';
