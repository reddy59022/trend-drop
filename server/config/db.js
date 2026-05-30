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
    // If the connection string uses the SRV scheme and DNS resolution fails,
    // we log a warning and allow the server to continue. This prevents the
    // entire Render deployment from crashing while still surfacing the issue.
    if (error.message && error.message.includes('ENOTFOUND')) {
      console.warn('MongoDB connection warning (ENOTFOUND):', error.message);
    } else {
      console.warn('MongoDB connection warning:', error.message);
    }
    // Do not exit – continue without a DB connection.
  }
};

module.exports = connectDB;