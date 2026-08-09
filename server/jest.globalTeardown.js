/**
 * Jest globalTeardown: stop the MongoMemoryServer started in
 * jest.globalSetup.js and remove the handoff files.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

const STATE_FILE = path.join(os.tmpdir(), 'trenddrop-mongoms-state.json');
const URI_FILE = path.join(__dirname, 'node_modules', '.cache', 'trenddrop-test-mongo-uri');

module.exports = async () => {
  // Disconnect any lingering Mongoose connections before stopping mongod
  try {
    const mongoose = require('mongoose');
    await mongoose.disconnect();
  } catch (err) { /* ignore */ }

  let mongod = global.__TRENDDROP_MONGOMS__;

  // Fallback: reconstruct from persisted instanceInfo if the global handle
  // is unavailable (e.g. different process context).
  if (!mongod) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (state.instanceInfo) {
        mongod = new MongoMemoryServer({ instance: state.instanceInfo });
      }
    } catch (err) {
      // No state file — nothing to stop.
    }
  }

  if (mongod) {
    try {
      await mongod.stop();
    } catch (err) {
      // Already stopped — fine.
    }
  }

  try { fs.unlinkSync(STATE_FILE); } catch (err) { /* ignore */ }
  try { fs.unlinkSync(URI_FILE); } catch (err) { /* ignore */ }
};
