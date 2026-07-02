const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
// Mongoose is needed for the health‑check endpoint.
const mongoose = require('mongoose');
// Load environment variables from .env only in non‑production environments.
// This prevents the local development NODE_ENV=development setting from overriding the production value set by Render.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const connectDB = require('./config/db');
const { initCronJobs } = require('./config/cron');
const { initializeWebSocket } = require('./websocket');
const http = require('http');

// Connect to MongoDB
connectDB();

// Initialize cron jobs for auto-expiration, auto-complete, reserve release
initCronJobs();

const app = express();

// Create HTTP server for Socket.io (must be before route mounting)
const server = http.createServer(app);

// Trust proxy for rate limiting behind reverse proxies (Render, Heroku, etc.)
app.set('trust proxy', 1);

// ====== Production Security & Rate Limiting ======

// General API rate limit: 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limit for auth endpoints (login/register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many auth attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiters (disabled in test mode)
if (process.env.NODE_ENV !== 'test') {
  app.use('/api/', apiLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
}

// Performance: Gzip compression (reduces response size by ~70%)
app.use(compression({
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Logging (minimal in production)
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// CORS for all platforms
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:8100',   // Capacitor dev server
    'http://10.0.2.2:8100',   // Android emulator localhost
    'http://127.0.0.1:8100',  // iOS simulator
    'https://trend-drop.onrender.com',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Stripe webhook MUST use raw body - mount before express.json()
app.use('/api/payments/webhook', require('./routes/stripeWebhook'));

// Body parsing with optimized limits
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Performance: Cache static assets in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build'), {
    maxAge: '30d',           // Cache static files for 30 days
    etag: true,
    lastModified: true,
    immutable: true,
  }));
}

// Performance: Set cache headers for API responses (must be BEFORE routes)
app.use('/api', (req, res, next) => {
  // Don't cache auth/transaction/payment endpoints
  if (req.path.includes('/auth') || req.path.includes('/transactions') || req.path.includes('/payments') || req.path.includes('/orders') || req.path.includes('/payouts')) {
    res.set('Cache-Control', 'no-store');
  } else if (req.method === 'GET') {
    // Cache read-only endpoints for 5 minutes
    res.set('Cache-Control', 'public, max-age=300');
  }
  // Enable ETag for conditional requests
  res.set('ETag', '');
  next();
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
// Analytics routes MUST be mounted before /api/users/:id to avoid conflict
app.use('/api/users/me', require('./routes/analytics'));
app.use('/api/users', require('./routes/users'));
app.use('/api/offers', require('./routes/offers'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/wishlist', require('./routes/wishlist'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/pricehistory', require('./routes/pricehistory'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/orders', require('./routes/orderLifecycle'));
app.use('/api/payouts', require('./routes/payouts'));
app.use('/api/shipping', require('./routes/shipping'));
// Boost configuration endpoint (client needs to fetch tier info, fees, etc.)
app.use('/api/boost', require('./routes/boost'));
// Admin routes (user management, platform oversight)
app.use('/api/admin', require('./routes/admin'));
// Saved search routes
app.use('/api/saved-searches', require('./routes/savedSearch'));
// Collection / storefront routes
app.use('/api/collections', require('./routes/collections'));
// Size guide routes
app.use('/api/size-guides', require('./routes/sizeGuides'));
// Promo / coupon code routes
app.use('/api/promos', require('./routes/promos'));
// Onboarding routes (mounted twice for different base paths)
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/users/me', require('./routes/onboarding'));

// ---------------------------------------------------------------------------
// Health check endpoints (must be defined before the SPA fallback)
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/mongo', async (req, res) => {
  // Ensure Mongoose is connected before trying to ping.
  if (mongoose.connection.readyState !== 1) {
    const msg = 'MongoDB not connected';
    console.warn('MongoDB health check warning:', msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
  try {
    // `db` is defined when the connection is open.
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'ok', mongo: 'connected' });
  } catch (e) {
    console.error('MongoDB health check failed:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// Serve static files in production (SPA fallback)
if (process.env.NODE_ENV === 'production') {
  // ============================================================
  // GET /verify-email - Handle email verification via link click
  // This endpoint is hit directly from the verification email URL.
  // It verifies the token (pending user or existing user) and then
  // redirects to the frontend with a success indicator.
  // ============================================================
  app.get('/verify-email', async (req, res) => {
    const token = req.query.token;
    console.log('Received email verification request for token:', token);
    if (!token) {
      return res.status(400).send('Verification token is required');
    }
    const PendingUser = require('./models/PendingUser');
    const User = require('./models/User');

    // Try pending user first
    let pending = await PendingUser.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: new Date() },
    });
    console.log('Pending user lookup result:', pending);
    if (pending) {
      const user = await User.create({
        name: pending.name,
        email: pending.email,
        password: pending.password,
        avatar: pending.avatar,
        emailVerified: true,
        authProvider: 'email',
      });
      await PendingUser.deleteOne({ _id: pending._id });
      return res.redirect(`${process.env.FRONTEND_URL}/login?verified=1`);
    }
    // Fallback to existing users
    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: new Date() },
    });
    console.log('User fallback lookup result:', user);
    if (!user) {
      return res.status(400).send('Invalid or expired verification token');
    }
    user.emailVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpires = null;
    await user.save();
    return res.redirect(`${process.env.FRONTEND_URL}/login?verified=1`);
  });

  // Serve static files in production (SPA fallback)
  app.get('*', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
} else {
  // Development root endpoint
  app.get('/', (req, res) => {
    res.json({ message: 'TrendDrop API is running' });
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File is too large. Maximum size is 2MB' });
    }
    return res.status(400).json({ message: err.message });
  }

  res.status(500).json({
    message: err.message || 'Internal Server Error',
  });
});

// Use a non‑default port to avoid clashes during development and test runs.
// The original default (5000) often remains bound after a test suite crashes,
// causing the server to fail to start. Switching to 5001 provides a clear
// separation and prevents `EADDRINUSE` errors.
const PORT = process.env.PORT || 5001;

// Initialize WebSocket server (only in production/development, not test)
if (process.env.NODE_ENV !== 'test') {
  initializeWebSocket(server);
}

// Only listen when not in test mode (tests import the app directly)
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
