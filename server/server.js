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

// General API rate limit: 1000 requests per 15 minutes per IP (~1.1 req/s).
// A marketplace SPA makes multiple API calls per page view (feed, listings,
// notifications, search), so a 100/15min cap would throttle legitimate users.
// 1000/15min still blocks scripted abuse while allowing normal browsing.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
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
    // Capacitor native origins — WKWebView (iOS) uses capacitor://localhost,
    // Android WebView with androidScheme 'https' uses https://localhost.
    // Without these, every API call from release native builds is CORS-blocked.
    'capacitor://localhost',
    'https://localhost',
    // Android WebView fallback origin names
    'http://localhost',
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

// Global ObjectId param validation: turns invalid IDs into 400 responses
// instead of 500 CastErrors, across every route. Mounted before all
// routers so no route can be reached with a malformed :id-style param
// (see utils/validators.js).
const { assertObjectId } = require('./utils/validators');
app.use('/api', assertObjectId);

// API Routes
app.use('/api/auth', require('./routes/auth'));
// Bulk listing management routes MUST be mounted before main listings route to avoid ID conflict
app.use('/api/listings', require('./routes/bulkListings'));
app.use('/api/listings', require('./routes/listings'));
// Analytics and onboarding routes MUST be mounted before /api/users/:id
// to avoid the users router's /:id catch-all swallowing /me/* paths.
app.use('/api/users/me', require('./routes/analytics'));
app.use('/api/users/me', require('./routes/onboarding'));
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
// Auction/Bidding System routes (v27.0)
app.use('/api/auctions', require('./routes/auctions'));
// Price Suggestion AI routes (v28.0)
app.use('/api/price-suggestions', require('./routes/priceSuggestions'));
// Cart / Abandoned Cart Recovery routes (v29.0)
app.use('/api/cart', require('./routes/cart'));
// Referral Program routes (v30.0)
app.use('/api/referrals', require('./routes/referrals'));
// Shipping Insurance routes (v31.0)
app.use('/api/shipping-insurance', require('./routes/shippingInsurance'));
// Fraud detection routes
app.use('/api/fraud', require('./routes/fraudDetection'));
// Returns & Refund Management routes
app.use('/api/returns', require('./routes/returns'));
// Escrow service routes (v26.0)
app.use('/api/escrow', require('./routes/escrow'));
// Onboarding routes (client uses the /api/onboarding base path)
app.use('/api/onboarding', require('./routes/onboarding'));
// Parties / Social Selling Events routes (v37.0)
app.use('/api/parties', require('./routes/parties'));
// Recently Viewed Items routes (v38.0)
app.use('/api/recently-viewed', require('./routes/recentlyViewed'));
// Seller Badges / Verification routes (v39.0)
app.use('/api/seller-badges', require('./routes/sellerBadges'));
// Virtual Try-On routes (v41.0)
app.use('/api/virtual-try-on', require('./routes/virtualTryOn'));
// Mobile Experience routes (v42.0)
app.use('/api/mobile', require('./routes/mobile'));
// Community comments routes (v43.0)
app.use('/api/comments', require('./routes/comments'));
// Advanced Search routes (v44.0)
app.use('/api/search', require('./routes/search'));
// Offer Sharing routes (v45.0)
app.use('/api/offer-sharing', require('./routes/offerSharing'));
// AI Stylist routes (v46.0)
app.use('/api/ai-stylist', require('./routes/aiStylist'));
// Live Shopping Events routes (v47.0)
app.use('/api/live-events', require('./routes/liveEvents'));
// AR Showrooms routes (v48.0)
app.use('/api/ar-showrooms', require('./routes/arShowrooms'));
// Social Commerce routes (v49.0)
app.use('/api/social-commerce', require('./routes/socialCommerce'));
// Advanced Analytics routes (v50.0)
app.use('/api/analytics', require('./routes/analytics'));
// Subscription routes (v51.0)
app.use('/api/subscriptions', require('./routes/subscriptions'));
// Cross-Border routes (v52.0)
app.use('/api/cross-border', require('./routes/crossBorder'));
// Trend Forecast routes (v53.0)
app.use('/api/trend-forecast', require('./routes/trendForecast'));
// Video Shopping routes (v54.0)
app.use('/api/video-shopping', require('./routes/videoShopping'));
// Seller Communities routes (v55.0)
app.use('/api/seller-communities', require('./routes/sellerCommunities'));
// Inventory Management routes (v56.0)
app.use('/api/inventory', require('./routes/inventory'));
// Loyalty Program routes (v57.0)
app.use('/api/loyalty', require('./routes/loyalty'));
// Vendors routes (v58.0)
app.use('/api/vendors', require('./routes/vendors'));
// Advanced Shipping routes (v59.0)
app.use('/api/advanced-shipping', require('./routes/advancedShipping'));
// Enterprise API routes (v60.0)
app.use('/api/enterprise', require('./routes/enterpriseApi'));
// Trend Tracking routes (v61.0)
app.use('/api/trends', require('./routes/trends'));
app.use('/api/notifications', require('./routes/notifications'));

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

  // Malformed ObjectId (e.g. /api/orders/undefined) is a client error, not a 500.
  if (err.name === 'CastError' || err.name === 'BSONError' || err.name === 'BSONTypeError') {
    return res.status(400).json({ message: 'Invalid ID', param: err.path || 'id' });
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
