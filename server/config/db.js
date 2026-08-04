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
  if (!rawUri || rawUri.includes('/trend-drop') && !rawUri.includes('trend-drop-test')) {
    rawUri = 'mongodb://localhost:27017/trend-drop-test';
  }
}
const mongoUri = cleanUri(rawUri) || 'mongodb://localhost:27017/trend-drop';

const connectDB = async () => {
  // If mongoose is already connected (e.g., a test suite explicitly connected
  // to its own URI), honor the existing connection instead of re-connecting.
  // This prevents `Can't call openUri() on an active connection with
  // different connection strings` across worker-process reuse.
  if (mongoose.connection.readyState !== 0) {
    return mongoose.connection;
  }
  // Attempt to connect using the provided MongoDB URI (standard or SRV).
  try {
    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    // Avoid logging after Jest test teardown (suppress noisy post-test output).
    if (process.env.NODE_ENV !== 'test') {
      console.log(`MongoDB Connected: ${conn.connection.host}`);
    }
    return conn;
  } catch (error) {
    // Log the error and continue without a DB connection.
    if (process.env.NODE_ENV !== 'test') {
      console.warn('MongoDB connection warning:', error.message);
    }
    return null;
  }
};

module.exports = connectDB;