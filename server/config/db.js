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
  // Attempt to connect using the provided MongoDB URI (standard or SRV).
  try {
    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    // Log the error and continue without a DB connection.
    console.warn('MongoDB connection warning:', error.message);
  }
};

module.exports = connectDB;