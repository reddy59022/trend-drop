const mongoose = require('mongoose');

// Connect to MongoDB using the MONGO_URI environment variable.
// If MONGO_URI is not provided (e.g., during local development or in a misconfigured Render env),
// fall back to a local MongoDB instance.
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/trend-drop";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(mongoUri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    // If the connection fails (e.g., missing MONGO_URI on Render), log the error but do not exit.
    // This allows the server to start, and routes that require the DB will handle the missing connection.
    console.error(`MongoDB connection error (non‑critical): ${error.message}`);
  }
};

module.exports = connectDB;