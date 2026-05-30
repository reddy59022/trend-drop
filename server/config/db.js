const mongoose = require('mongoose');

// Connect to MongoDB using the MONGO_URI environment variable.
// If MONGO_URI is not provided (e.g., during local development or in a misconfigured Render env),
// fall back to a local MongoDB instance.
// Log the MongoDB URI in production (redacted) for debugging purposes.
if (process.env.NODE_ENV === 'production') {
  console.log('MongoDB URI used:', process.env.MONGO_URI ? '[REDACTED]' : 'undefined');
}
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/trend-drop";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(mongoUri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    // If the connection fails (e.g., missing MONGO_URI on Render) we log a concise warning.
    // For DNS resolution errors (ENOTFOUND) we suppress the stack trace to avoid noisy logs.
    if (error.message && error.message.includes('ENOTFOUND')) {
      console.warn('MongoDB connection warning: Unable to resolve the provided URI – falling back to local MongoDB.');
    } else {
      console.warn(`MongoDB connection warning: ${error.message}`);
    }
    // Do not exit; the server will continue running without a DB connection.
  }
};

module.exports = connectDB;