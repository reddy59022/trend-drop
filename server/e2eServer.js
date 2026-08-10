/**
 * E2E Test Server — starts the full TrendDrop app against an in-memory MongoDB
 * with seeded test data, so Playwright can exercise real user flows.
 *
 * Usage: node server/e2eServer.js   (started automatically by Playwright webServer)
 */
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Pin mongod binary version compatible with macOS 12 (same as jest.globalSetup)
process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '7.0.14';

async function main() {
  // 1. Spin up in-memory MongoDB
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('trenddrop-e2e');

  // 2. Configure environment BEFORE requiring server.js
  process.env.NODE_ENV = 'production';
  process.env.PORT = process.env.E2E_PORT || '5001';
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.JWT_SECRET = 'e2e-test-secret-do-not-use-in-prod';
  process.env.FRONTEND_URL = `http://localhost:${process.env.PORT}`;
  process.env.CLIENT_URL = `http://localhost:${process.env.PORT}`;
  // Placeholder keys — E2E never touches real external services
  process.env.CLOUDINARY_CLOUD_NAME = 'placeholder';
  process.env.CLOUDINARY_API_KEY = 'placeholder';
  process.env.CLOUDINARY_API_SECRET = 'placeholder';
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_placeholder';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder';
  process.env.BREVO_API_KEY = 'xkeysib-placeholder';
  process.env.GOOGLE_CLIENT_ID = 'placeholder.apps.googleusercontent.com';
  process.env.REACT_APP_GOOGLE_CLIENT_ID = 'placeholder.apps.googleusercontent.com';

  // 3. Seed data (must happen after mongoose connects, so we require models
  //    and connect manually before seeding; server.js will reuse the connection)
  const mongoose = require('mongoose');
  const bcrypt = require('bcryptjs');

  const PASSWORD = 'E2ePass123!';
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  await mongoose.connect(uri, { dbName: 'trenddrop-e2e' });

  const User = require('./models/User');
  const Listing = require('./models/Listing');
  const Trend = require('./models/Trend');

  // Seed users — backdated createdAt so the 14-day new-seller payout hold is bypassed
  const [buyer, seller, seller2] = await User.create([
    {
      name: 'E2E Buyer',
      email: 'e2e-buyer@trenddrop.test',
      password: passwordHash,
      emailVerified: true,
      authProvider: 'email',
      role: 'user',
      country: 'US',
      currency: 'USD',
      shippingAddress: { fullName: 'E2E Buyer', street1: '123 Test St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
      balance: { available: 5000, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
      stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
      createdAt: thirtyDaysAgo,
    },
    {
      name: 'E2E Seller',
      email: 'e2e-seller@trenddrop.test',
      password: passwordHash,
      emailVerified: true,
      authProvider: 'email',
      role: 'user',
      country: 'US',
      currency: 'USD',
      shippingAddress: { fullName: 'E2E Seller', street1: '456 Seller St', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
      balance: { available: 1000, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
      stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
      createdAt: thirtyDaysAgo,
      payoutMethod: { type: 'bank', details: { accountNumber: '123456789', routingNumber: '987654321', accountHolderName: 'E2E Seller' } },
    },
    {
      name: 'E2E Seller Two',
      email: 'e2e-seller2@trenddrop.test',
      password: passwordHash,
      emailVerified: true,
      authProvider: 'email',
      role: 'user',
      country: 'US',
      currency: 'USD',
      shippingAddress: { fullName: 'E2E Seller Two', street1: '789 Vendor Way', city: 'Dallas', state: 'TX', postalCode: '75201', country: 'US' },
      balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
      stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
      createdAt: thirtyDaysAgo,
      payoutMethod: { type: 'bank', details: { accountNumber: '555666777', routingNumber: '111222333', accountHolderName: 'E2E Seller Two' } },
    },
  ]);

  const now = Date.now();
  await Listing.create([
    {
      seller: seller._id,
      title: 'Vintage Denim Jacket',
      description: 'Classic 90s oversized denim jacket, great condition.',
      price: 89.99,
      originalPrice: 149.99,
      category: 'Men',
      condition: 'Good',
      size: 'M',
      quantity: 3,
      brand: 'Levi\'s',
      shipsFrom: 'US',
      available: true,
      sold: false,
      views: 120,
      likes: [],
      likesCount: 8,
      images: [],
      createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
    },
    {
      seller: seller._id,
      title: 'Silk Evening Dress',
      description: 'Elegant emerald silk dress, size S, worn once.',
      price: 129.0,
      originalPrice: 259.0,
      category: 'Women',
      condition: 'New with tags',
      size: 'S',
      quantity: 1,
      brand: 'Reformation',
      shipsFrom: 'US',
      available: true,
      sold: false,
      views: 340,
      likes: [],
      likesCount: 22,
      images: [],
      createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
    },
    {
      seller: seller2._id,
      title: 'Handmade Leather Tote',
      description: 'Full-grain leather tote handcrafted in Texas.',
      price: 199.0,
      originalPrice: 299.0,
      category: 'Women',
      condition: 'New without tags',
      size: 'One Size',
      quantity: 5,
      brand: 'Texas Leather Co',
      shipsFrom: 'US',
      available: true,
      sold: false,
      views: 210,
      likes: [],
      likesCount: 15,
      images: [],
      createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
    },
  ]);

  console.log(`[e2eServer] Seeded users: buyer=${buyer.email}, seller=${seller.email}, seller2=${seller2.email}`);
  console.log(`[e2eServer] Seeded 3 listings`);

  // Seed a few trends so the Trends dashboard has real data
  await Trend.create([
    {
      postId: 'e2e-trend-1',
      text: '#Y2KFashion is making a comeback — low-rise everything 🔥',
      author: 'trendbot',
      hashtags: ['Y2KFashion', 'Streetwear'],
      likes: 2400,
      reposts: 310,
      replies: 120,
      views: 150000,
      timestamp: new Date(now - 2 * 60 * 60 * 1000),
      isViral: true,
    },
    {
      postId: 'e2e-trend-2',
      text: 'Vintage denim jackets are trending up 40% this week',
      author: 'fashionwatch',
      hashtags: ['Denim', 'Vintage'],
      likes: 890,
      reposts: 95,
      replies: 40,
      views: 42000,
      timestamp: new Date(now - 5 * 60 * 60 * 1000),
      isViral: false,
    },
    {
      postId: 'e2e-trend-3',
      text: 'Handmade leather goods dominate seller communities in TX',
      author: 'makernews',
      hashtags: ['Leather', 'Handmade'],
      likes: 1500,
      reposts: 210,
      replies: 88,
      views: 98000,
      timestamp: new Date(now - 9 * 60 * 60 * 1000),
      isViral: true,
    },
  ]);
  console.log('[e2eServer] Seeded 3 trends');

  // 4. Start the real application (listens on PORT, serves client build)
  require('../server/server.js');

  // Keep process alive; Playwright kills it when done
}

main().catch((err) => {
  console.error('[e2eServer] FATAL:', err);
  process.exit(1);
});
