const mongoose = require('mongoose');

// Connect to MongoDB using the MONGO_URI environment variable.
// If MONGO_URI is not provided (e.g., during local development or in a misconfigured Render env),
// fall back to a local MongoDB instance.
// Log the MongoDB URI in production (redacted) for debugging purposes.
if (process.env.NODE_ENV === 'production') {
  console.log('MongoDB URI used:', process.env.MONGO_URI ? '[REDACTED]' : 'undefined');
}
// Use the provided MONGO_URI if set; otherwise fall back to a local MongoDB instance.
// Remove any surrounding quotes that might be present in the env var (e.g., "mongodb+srv://...")
const rawUri = process.env.MONGO_URI && typeof process.env.MONGO_URI === 'string'
  ? process.env.MONGO_URI.trim().replace(/^"+|"+$/g, '')
  : '';
const mongoUri = rawUri.length > 0 ? rawUri : "mongodb://localhost:27017/trend-drop";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      // Enable DNS seedlist (SRV) resolution for Atlas clusters
      dnsSeedlistEnabled: true,
    });
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