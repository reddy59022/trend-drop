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

const dns = require('dns').promises;
// Use public DNS resolvers to improve SRV lookup reliability in constrained environments.
dns.setServers(['8.8.8.8', '1.1.1.1']);

const connectDB = async () => {
  // Primary attempt: use the provided URI (SRV or standard).
  try {
    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return;
  } catch (error) {
    // If the error indicates SRV resolution failure, attempt manual SRV lookup.
    if (error.message && error.message.includes('ENOTFOUND')) {
      console.warn('SRV lookup failed, attempting DNS‑over‑HTTPS fallback');
      try {
      // Fallback: construct a standard (non‑SRV) MongoDB URI using the three shard hosts.
      // Example rawUri: mongodb+srv://user:pass@cluster0.mongodb.net/poshmark?retryWrites=true&w=majority
      const uriMatch = rawUri.match(/^mongodb\+srv:\/\/(.+?)@([^/]+)\/(.+)$/);
      if (!uriMatch) throw new Error('Unable to parse SRV URI components');
      const credentials = uriMatch[1]; // "user:pass"
      const srvHost = uriMatch[2]; // e.g., "cluster0.mongodb.net"
      const afterSlash = uriMatch[3]; // "poshmark?retryWrites=..."
      // Derive the base cluster name (e.g., "cluster0")
      const baseCluster = srvHost.split('.')[0];
      // Build the host list for the three shard members.
      const hostList = `${baseCluster}-shard-00-00.mongodb.net:27017,${baseCluster}-shard-00-01.mongodb.net:27017,${baseCluster}-shard-00-02.mongodb.net:27017`;
      // Preserve existing query parameters and ensure TLS is enabled for Atlas.
      const separator = afterSlash.includes('?') ? '&' : '?';
      const manualUri = `mongodb://${credentials}@${hostList}/${afterSlash}${separator}tls=true`;
      const conn = await mongoose.connect(manualUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log(`MongoDB Connected via manual non‑SRV fallback: ${conn.connection.host}`);
      return;
      } catch (fallbackErr) {
        console.warn('DoH fallback failed:', fallbackErr.message);
      }
    }
    // Generic warning for any other connection issue.
    console.warn('MongoDB connection warning:', error.message);
  }
};

module.exports = connectDB;