const mongoose = require('mongoose');

// Connect to MongoDB.
// Precedence:
//   1. MONGO_URI    (production / Render)
//   2. MONGODB_URI  (used by tests and local tooling; the app MUST honor it too so
//                    tests and the app under test always share the same database)
//   3. Local fallback
// In test mode, prefer a dedicated test database so test runs never touch dev data.
// Log the MongoDB URI in production (redacted) for debugging purposes.
const cleanUri = (uri) => (typeof uri === 'string' ? uri.trim().replace(/^"+|"+$/g, '') : '');

if (process.env.NODE_ENV === 'production') {
  const used = process.env.MONGO_URI || process.env.MONGODB_URI;
  console.log('MongoDB URI used:', used ? '[REDACTED]' : 'undefined');
}

let rawUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (process.env.NODE_ENV === 'test') {
  // Tests use MONGODB_URI convention; never let tests point at the dev DB name.
  rawUri = cleanUri(process.env.MONGODB_URI);
  if (!rawUri || (rawUri.includes('/trend-drop') && !rawUri.includes('trend-drop-test'))) {
    rawUri = 'mongodb://localhost:27017/trend-drop-test';
  }
}
const mongoUri = cleanUri(rawUri) || 'mongodb://localhost:27017/trend-drop';

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectDB = async () => {
  // If mongoose is already connected (e.g., a test suite explicitly connected
  // to its own URI), honor the existing connection instead of re-connecting.
  // This prevents `Can't call openUri() on an active connection with
  // different connection strings` across worker-process reuse.
  if (mongoose.connection.readyState !== 0) {
    return mongoose.connection;
  }

  let lastError;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      // useNewUrlParser/useUnifiedTopology are Mongoose 7 defaults; passing
      // them is deprecated and may log warnings — rely on the defaults.
      const conn = await mongoose.connect(mongoUri);
      // Avoid logging after Jest test teardown (suppress noisy post-test output).
      if (process.env.NODE_ENV !== 'test') {
        console.log(`MongoDB Connected: ${conn.connection.host}`);
      }
      return conn;
    } catch (error) {
      lastError = error;
      if (process.env.NODE_ENV !== 'test') {
        console.error(`MongoDB connection attempt ${attempt}/${RETRY_COUNT} failed:`, error.message);
      }
      if (attempt < RETRY_COUNT) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // All retries exhausted.
  if (process.env.NODE_ENV === 'production') {
    console.error(
      `FATAL: Could not connect to MongoDB after ${RETRY_COUNT} attempts (${mongoUri}). ` +
      'Refusing to start the server without a database. Check MONGO_URI/MONGODB_URI.'
    );
    process.exit(1);
  }

  // Development: surface the error so server.js can handle it (server stays
  // up for health checks, but the failure is visible).
  if (process.env.NODE_ENV !== 'test') {
    console.warn('MongoDB connection failed in development:', lastError.message);
  }
  throw lastError;
};

module.exports = connectDB;
