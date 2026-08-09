/**
 * Jest globalSetup: start an in-memory MongoDB (mongodb-memory-server) once
 * per test run, before any test worker runs.
 *
 * Env vars set here do NOT propagate to test workers, so the connection URI
 * is handed off via a file that jest.setup.js reads inside every worker
 * (setupFilesAfterEnv runs before the test file is evaluated, which is what
 * lets us set MONGODB_URI/MONGO_URI before `require('../server.js')` triggers
 * connectDB()).
 *
 * The dbName MUST contain "trend-drop-test": config/db.js validates the test
 * URI and would otherwise replace a differently-named URI with the
 * localhost fallback.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Pin the mongod binary version so the cache key is stable across runs.
// (Same default as mongodb-memory-server-core 11.2.0; set explicitly so an
// upstream default bump never triggers a surprise re-download.)
process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '7.0.14';

const STATE_FILE = path.join(os.tmpdir(), 'trenddrop-mongoms-state.json');
const URI_FILE = path.join(__dirname, 'node_modules', '.cache', 'trenddrop-test-mongo-uri');

module.exports = async () => {
  const mongod = await MongoMemoryServer.create({
    instance: {
      dbName: 'trend-drop-test',
      // Keep the on-disk footprint modest and avoid oplog/journal overhead
      // in CI. (--nojournal was removed in MongoDB 5+, so we skip it.)
      storageEngine: 'wiredTiger',
    },
  });
  const uri = mongod.getUri('trend-drop-test');

  fs.mkdirSync(path.dirname(URI_FILE), { recursive: true });
  fs.writeFileSync(URI_FILE, uri);
  fs.writeFileSync(STATE_FILE, JSON.stringify({ uri, instanceInfo: mongod.instanceInfo }));

  // Share the running instance with globalTeardown (same global context),
  // with the state file as a fallback if that contract ever changes.
  global.__TRENDDROP_MONGOMS__ = mongod;
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;

  console.log(`[jest] MongoMemoryServer ready: ${uri}`);
};
