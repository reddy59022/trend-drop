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
  process.env.DISABLE_RATE_LIMIT = 'true';
  process.env.E2E_IN_MEMORY = '1';
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.E2E_IN_MEMORY = '1';
  process.env.JWT_SECRET = 'e2e-test-secret-do-not-use-in-prod';
  process.env.FRONTEND_URL = `http://localhost:${process.env.PORT}`;
  process.env.CLIENT_URL = `http://localhost:${process.env.PORT}`;
  // Skip Stripe SDK init in in-memory E2E so test-confirm uses the
  // hermetic mock path (no outbound calls to api.stripe.com).
  process.env.SKIP_STRIPE_INIT = 'true';
  // Placeholder keys — E2E never touches real external services UNLESS the
  // caller explicitly provides real keys (e.g. Stripe test-mode live checkout
  // in stripe-checkout.spec.js). Only set placeholders when the env var is
  // absent, so real keys passed to e2eServer flow through to the app.
  // NOTE: Stripe placeholder MUST NOT start with sk_test_/sk_live_ so the
  // Stripe SDK stays uninitialised in in-memory E2E and test-confirm uses
  // the hermetic mock path (no outbound calls to api.stripe.com).
  if (!process.env.CLOUDINARY_CLOUD_NAME) process.env.CLOUDINARY_CLOUD_NAME = 'placeholder';
  if (!process.env.CLOUDINARY_API_KEY) process.env.CLOUDINARY_API_KEY = 'placeholder';
  if (!process.env.CLOUDINARY_API_SECRET) process.env.CLOUDINARY_API_SECRET = 'placeholder';
  if (!process.env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
  if (!process.env.STRIPE_PUBLISHABLE_KEY) process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_placeholder';
  if (!process.env.STRIPE_WEBHOOK_SECRET) process.env.STRIPE_WEBHOOK_SECRET = 'placeholder';
  if (!process.env.BREVO_API_KEY) process.env.BREVO_API_KEY = 'xkeysib-placeholder';
  if (!process.env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = 'placeholder.apps.googleusercontent.com';
  if (!process.env.REACT_APP_GOOGLE_CLIENT_ID) process.env.REACT_APP_GOOGLE_CLIENT_ID = 'placeholder.apps.googleusercontent.com';

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
  const Transaction = require('./models/Transaction');
  const Payout = require('./models/Payout');
  const Cart = require('./models/Cart');
  const Order = require('./models/Order');
  const Offer = require('./models/Offer');
  const ShippingInsurance = require('./models/ShippingInsurance');
  const SellerBadge = require('./models/SellerBadge');
  const BundleRule = require('./models/BundleRule');
  const Promo = require('./models/Promo');
  const Collection = require('./models/Collection');
  const SellerCommunity = require('./models/SellerCommunity');
  const LoyaltyProgram = require('./models/LoyaltyProgram');
  const Comment = require('./models/Comment');
  const Rating = require('./models/Rating');
  const Auction = require('./models/Auction');
  const Subscription = require('./models/Subscription');
  const Return = require('./models/Return');
  const Wishlist = require('./models/Wishlist');
  const PushDevice = require('./models/PushDevice');

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
  const RUN_ID = process.env.E2E_RUN_ID || 'INMEM';
  const sellerListings = await Listing.create([
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
      currency: 'USD',
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
      currency: 'USD',
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
      currency: 'USD',
      createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
    },
  ]);

  console.log(`[e2eServer] Seeded users: buyer=${buyer.email}, seller=${seller.email}, seller2=${seller2.email}`);
  console.log(`[e2eServer] Seeded 3 listings`);

  // --- Seller badges ---
  await SellerBadge.create({
    userId: seller._id,
    badges: ['starter', 'verified'],
    tier: 'silver',
    tierPoints: 500,
    totalEarnings: 5000,
    totalSales: 25,
    totalReviews: 18,
    avgRating: 4.8,
  });
  await SellerBadge.create({
    userId: seller2._id,
    badges: ['starter'],
    tier: 'bronze',
    tierPoints: 100,
    totalEarnings: 800,
    totalSales: 4,
    totalReviews: 2,
    avgRating: 4.5,
  });

  // --- Transactions (completed sales, so payouts/badges have real data) ---
  const txns = await Transaction.create([
    {
      buyer: buyer._id,
      seller: seller._id,
      listing: sellerListings[0]._id,
      quantity: 1,
      itemPrice: 89.99,
      currency: 'USD',
      paymentBreakdown: {
        subtotal: 89.99,
        shippingCost: 0,
        buyerProtectionFee: 4.5,
        buyerProtectionPercent: 5,
        tax: 0,
        totalPaid: 94.49,
        platformFee: 7.2,
        platformFeePercent: 8,
        shippingPayout: 0,
        sellerEarnings: 82.79,
        paymentIntentId: 'pi_e2e_completed_1',
      },
      paymentIntentId: 'pi_e2e_completed_1',
      status: 'completed',
      shippingAddress: { fullName: 'E2E Buyer', street1: '123 Test St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
      createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
    },
    {
      buyer: buyer._id,
      seller: seller._id,
      listing: sellerListings[1]._id,
      quantity: 1,
      itemPrice: 129.0,
      currency: 'USD',
      paymentBreakdown: {
        subtotal: 129.0,
        shippingCost: 0,
        buyerProtectionFee: 6.45,
        buyerProtectionPercent: 5,
        tax: 0,
        totalPaid: 135.45,
        platformFee: 10.32,
        platformFeePercent: 8,
        shippingPayout: 0,
        sellerEarnings: 118.68,
        paymentIntentId: 'pi_e2e_completed_2',
      },
      paymentIntentId: 'pi_e2e_completed_2',
      status: 'completed',
      shippingAddress: { fullName: 'E2E Buyer', street1: '123 Test St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
      createdAt: new Date(now - 7 * 24 * 60 * 60 * 1000),
    },
    {
      buyer: buyer._id,
      seller: seller._id,
      listing: sellerListings[2]._id,
      quantity: 1,
      itemPrice: 199.0,
      currency: 'USD',
      paymentBreakdown: {
        subtotal: 199.0,
        shippingCost: 0,
        buyerProtectionFee: 9.95,
        buyerProtectionPercent: 5,
        tax: 0,
        totalPaid: 208.95,
        platformFee: 15.92,
        platformFeePercent: 8,
        shippingPayout: 0,
        sellerEarnings: 183.08,
        paymentIntentId: 'pi_e2e_completed_3',
      },
      paymentIntentId: 'pi_e2e_completed_3',
      status: 'completed',
      shippingAddress: { fullName: 'E2E Buyer', street1: '123 Test St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
      createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
    },
  ]);

  // --- Payouts (per-sale commission records; require transaction + listing refs) ---
  await Payout.create([
    {
      seller: seller._id,
      transaction: txns[0]._id,
      listing: sellerListings[0]._id,
      salePrice: 89.99,
      commissionRate: 0.08,
      commissionAmount: 7.2,
      payoutAmount: 82.79,
      availableBalance: 82.79,
      amount: 82.79,
      currency: 'USD',
      method: 'bank_transfer',
      status: 'completed',
      stripePayoutId: 'tr_e2e_payout_1',
      paymentIntentId: 'pi_e2e_completed_1',
      paidAt: new Date(now - 8 * 24 * 60 * 60 * 1000),
      createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
    },
    {
      seller: seller._id,
      transaction: txns[1]._id,
      listing: sellerListings[1]._id,
      salePrice: 129.0,
      commissionRate: 0.08,
      commissionAmount: 10.32,
      payoutAmount: 118.68,
      availableBalance: 118.68,
      amount: 118.68,
      currency: 'USD',
      method: 'bank_transfer',
      status: 'pending',
      paymentIntentId: 'pi_e2e_completed_2',
      createdAt: new Date(now - 7 * 24 * 60 * 60 * 1000),
    },
    {
      seller: seller2._id,
      transaction: txns[2]._id,
      listing: sellerListings[2]._id,
      salePrice: 199.0,
      commissionRate: 0.08,
      commissionAmount: 15.92,
      payoutAmount: 183.08,
      availableBalance: 183.08,
      amount: 183.08,
      currency: 'USD',
      method: 'stripe_connect',
      status: 'completed',
      stripePayoutId: 'tr_e2e_payout_2',
      paymentIntentId: 'pi_e2e_completed_3',
      paidAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
      createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
    },
  ]);

  // --- Cart (single doc per user; items is an embedded array) ---
  await Cart.create({
    user: buyer._id,
    items: [
      { listing: sellerListings[0]._id, quantity: 1, addedAt: new Date(now - 2 * 60 * 60 * 1000) },
      { listing: sellerListings[1]._id, quantity: 1, addedAt: new Date(now - 1 * 60 * 60 * 1000) },
    ],
        status: 'active',
  });

    // --- Orders in various lifecycle states ---
  // orderItemSchema requires a transaction ref, so wire the seeded txns through.
  await Order.create([
    {
      orderNumber: 'E2E-ORD-001',
      buyer: buyer._id,
      sellers: [seller._id],
      currency: 'USD',
      items: [{
        listing: sellerListings[0]._id,
        transaction: txns[0]._id,
        seller: seller._id,
        title: sellerListings[0].title,
        price: sellerListings[0].price,
        quantity: 1,
      }],
      shipments: [{
        seller: seller._id,
        items: [txns[0]._id],
        status: 'shipped',
        trackingNumber: 'USPS-E2E-123456789',
        carrier: 'USPS',
        shippedAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
      }],
      totals: { subtotal: 89.99, shipping: 5.0, protectionFees: 0, discounts: 0, total: 94.99 },
      payment: { paymentIntentId: 'pi_e2e_ord_1', status: 'captured', currency: 'USD', totalHeld: 94.99 },
      status: 'shipped',
      shippingAddress: { fullName: 'E2E Buyer', street1: '123 Test St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
      createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
    },
    {
      orderNumber: 'E2E-ORD-002',
      buyer: buyer._id,
      sellers: [seller._id],
      currency: 'USD',
      items: [{
        listing: sellerListings[1]._id,
        transaction: txns[1]._id,
        seller: seller._id,
        title: sellerListings[1].title,
        price: sellerListings[1].price,
        quantity: 1,
      }],
      shipments: [{
        seller: seller._id,
        items: [txns[1]._id],
        status: 'delivered',
        trackingNumber: 'USPS-E2E-987654321',
        carrier: 'USPS',
        shippedAt: new Date(now - 4 * 24 * 60 * 60 * 1000),
      }],
      totals: { subtotal: 129.0, shipping: 5.0, protectionFees: 0, discounts: 0, total: 134.0 },
      payment: { paymentIntentId: 'pi_e2e_ord_2', status: 'captured', currency: 'USD', totalHeld: 134.0 },
      status: 'completed',
      shippingAddress: { fullName: 'E2E Buyer', street1: '123 Test St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
      createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
    },
  ]);

  // --- Offer ---
  await Offer.create({
    listing: sellerListings[0]._id,
    buyer: buyer._id,
    seller: seller._id,
    amount: 75.00,
    status: 'pending',
    createdAt: new Date(now - 1 * 60 * 60 * 1000),
  });

  // --- Shipping insurance ---
  await ShippingInsurance.create({
    seller: seller._id,
    transaction: txns[0]._id,
    itemValue: 89.99,
    insuredValue: 89.99,
    premium: 3.00,
    status: 'active',
    coverageType: 'standard',
    expiresAt: new Date(now - 5 * 60 * 60 * 1000),
  });

  // --- Promo codes (seeded; specs also create their own) ---
  await Promo.create([
    {
      code: `E2E-SEED-${RUN_ID}`,
      description: 'Seeded E2E test promo',
      discountType: 'percentage',
      discountValue: 10,
      minOrderValue: 30,
      maxUses: 100,
      usedCount: 0,
      isActive: true,
      seller: seller._id,
    },
  ]);

  // --- Collections ---
  await Collection.create({
    name: `E2E ${RUN_ID} Collection`,
    description: 'Seeded E2E test collection',
    seller: seller._id,
    listings: [sellerListings[0]._id, sellerListings[1]._id],
  });

  // --- Ratings / Reviews (seller gets a 5-star review on a completed sale) ---
  await Rating.create({
    listing: sellerListings[0]._id,
    reviewer: buyer._id,
    seller: seller._id,
    rating: 5,
    review: 'Excellent jacket, fast shipping — highly recommend!',
  });

  // --- Wishlist (buyer has one saved listing) ---
  await Wishlist.create({
    user: buyer._id,
    items: [{ listing: sellerListings[2]._id }],
  });

  // --- Subscriptions (seller on 'pro' tier) ---
  await Subscription.create({
    seller: seller._id,
    tier: 'pro',
    status: 'active',
    billingCycle: 'monthly',
    price: 29.99,
    features: { reducedFees: true, analyticsAccess: true, enhancedPromotions: true },
  });

  // --- Seller Community with a challenge ---
  await SellerCommunity.create({
    name: `E2E ${RUN_ID} Community`,
    description: 'Seeded community for E2E tests',
    members: [seller._id, seller2._id],
    inviteCode: `e2e-${RUN_ID}`,
    challenges: [{
      title: 'First Sale Challenge',
      description: 'Make your first sale',
      startDate: new Date(now - 30 * 24 * 60 * 60 * 1000),
      endDate: new Date(now - 1 * 24 * 60 * 60 * 1000),
      rewards: 'Bronze badge',
      participants: [seller._id],
    }],
    achievements: [{ member: seller._id, badge: 'top_seller', awardedAt: new Date(now - 5 * 24 * 60 * 60 * 1000) }],
  });

  // --- Loyalty program (buyer has 250 points) ---
  await LoyaltyProgram.create({
    user: buyer._id,
    points: 250,
    tier: 'Gold',
    pointsHistory: [{ amount: 250, reason: 'purchase', listing: sellerListings[0]._id }],
  });

  // --- Closed auction (ended, has a winner) ---
  const closedAuctionEndTime = new Date(now - 1 * 60 * 60 * 1000);
  await Auction.create({
    listing: sellerListings[1]._id,
    seller: seller._id,
    startTime: new Date(now - 3 * 60 * 60 * 1000),
    endTime: closedAuctionEndTime,
    reservePrice: 80,
    currency: 'USD',
    currentBid: 130,
    status: 'closed',
    bids: [{ bidder: buyer._id, amount: 130, currency: 'USD' }],
    winner: buyer._id,
    winningBid: 130,
  });

  // --- Active auction (future end time) ---
  await Auction.create({
    listing: sellerListings[2]._id,
    seller: seller2._id,
    startTime: new Date(now - 30 * 60 * 1000),
    endTime: new Date(now + 30 * 60 * 1000),
    reservePrice: 100,
    currency: 'USD',
    currentBid: 0,
    status: 'active',
  });

  // --- Comments on a listing ---
  await Comment.create({
    listingId: sellerListings[0]._id,
    userId: buyer._id,
    text: 'Love this jacket! #denim #vintage',
    parentId: null,
  });

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
