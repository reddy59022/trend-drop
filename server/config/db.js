const mongoose = require('mongoose');

// Connect to MongoDB using the MONGO_URI environment variable.
// If MONGO_URI is not provided (e.g., during local development or in a misconfigured Render env),
// fall back to a local MongoDB instance.
// Log the MongoDB URI in production (redacted) for debugging purposes.
if (process.env.NODE_ENV === 'production') {
  console.log('MongoDB URI used:', process.env.MONGO_URI ? '[REDACTED]' : 'undefined');
}
// Use the provided MONGO_URI if set; otherwise fall back to a local MongoDB instance.
const mongoUri = process.env.MONGO_URI && process.env.MONGO_URI.trim().length > 0
  ? process.env.MONGO_URI.trim()
  : "mongodb://localhost:27017/trend-drop";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(mongoUri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    // If a MONGO_URI was explicitly provided, treat connection failures as critical.
    if (process.env.MONGO_URI && process.env.MONGO_URI.trim().length > 0) {
      console.error('Critical MongoDB connection error:', error.message);
      // Exit to surface the problem in Render logs.
      process.exit(1);
    } else {
      // No URI supplied – fallback to local MongoDB (already the default).
      console.warn('MongoDB connection warning: Unable to connect to local MongoDB.');
    }
  }
};

module.exports = connectDB;