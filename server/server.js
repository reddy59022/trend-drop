const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const connectDB = require('./config/db');

// Connect to MongoDB
connectDB();

const app = express();

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

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

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

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/users', require('./routes/users'));
app.use('/api/offers', require('./routes/offers'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/wishlist', require('./routes/wishlist'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/pricehistory', require('./routes/pricehistory'));
app.use('/api/payouts', require('./routes/payouts'));

// Performance: Set cache headers for API responses
app.use('/api', (req, res, next) => {
  // Don't cache auth/transaction endpoints
  if (req.path.includes('/auth') || req.path.includes('/transactions')) {
    res.set('Cache-Control', 'no-store');
  } else {
    // Cache read-only endpoints for 5 minutes
    if (req.method === 'GET') {
      res.set('Cache-Control', 'public, max-age=300');
    }
  }
  // Enable ETag for conditional requests
  res.set('ETag', '');
  next();
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  // SPA fallback with cache
  app.get('*', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({ message: 'TrendDrop API is running' });
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File is too large. Maximum size is 5MB' });
    }
    return res.status(400).json({ message: err.message });
  }

  res.status(500).json({
    message: err.message || 'Internal Server Error',
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});