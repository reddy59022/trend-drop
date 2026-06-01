/**
 * Boost System E2E Tests
 * Tests the complete boost flow: creation, selection, fee calculation, revenue split
 * 
 * Boost Tiers:
 * - Standard: 10% fee - Priority placement, Featured badge, Search boost
 * - Premium: 15% fee - Top placement + Standard features + Homepage spotlight, Category highlight
 * - Elite: 20% fee - #1 placement + Premium features + Push notifications, Social media promotion
 * 
 * Revenue Split:
 * - Platform gets: 8% platform fee + boost fee (10%/15%/20%)
 * - Seller gets: item price - 8% platform fee - boost fee
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const { calculateBoostFee, boostConfig } = require('../config/boost');
const { calculatePaymentBreakdown } = require('../config/payments');

const mkEmail = p => `${p}_boost_${Date.now()}@test.com`;
const PASS = 'password123';

let sellerToken, buyerToken, sellerId, buyerId;

async function createUser(name, email) {
  const u = await User.create({
    name, email: email.toLowerCase(), password: PASS, emailVerified: true,
    authProvider: 'email', country: 'US', currency: 'USD',
    shippingAddress: { fullName: name, street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 500, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 }
  });
  const jwt = require('jsonwebtoken');
  const t = jwt.sign({ id: u._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '30d' });
  return { user: u, token: t };
}

async function createListingWithBoost(sellerToken, overrides = {}) {
  // Add a test image
  const imageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  
  const req = request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${sellerToken}`)
    .attach('images', imageBuffer, 'test.png')
    .field('title', overrides.title || 'Boost Test Item')
    .field('description', overrides.description || 'Test description for boost')
    .field('price', String(overrides.price || 100))
    .field('category', overrides.category || 'Women')
    .field('condition', overrides.condition || 'New with tags')
    .field('quantity', String(overrides.quantity || 5));
  
  if (overrides.boostTier) {
    req.field('boostTier', overrides.boostTier);
  }
  if (overrides.boostDuration) {
    req.field('boostDuration', String(overrides.boostDuration));
  }
  
  return req;
}

beforeAll(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://reddy59022_db_user:anNecZCiT3eJQfre@cluster.mongodb.net/poshmark?retryWrites=true&w=majority';
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  
  // Cleanup
  await User.deleteMany({ email: /boost_test/ });
  await Listing.deleteMany({ title: /Boost Test/ });
  await Transaction.deleteMany({});
  
  const { user: s, token: st } = await createUser('BoostSeller', mkEmail('seller'));
  sellerId = s._id;
  sellerToken = st;
  
  const { user: b, token: bt } = await createUser('BoostBuyer', mkEmail('buyer'));
  buyerId = b._id;
  buyerToken = bt;
});

afterAll(async () => {
  await User.deleteMany({ email: /boost_test/ });
  await Listing.deleteMany({ title: /Boost Test/ });
  await mongoose.disconnect();
});

// ============================================================
// TEST 1: Boost Configuration
// ============================================================
describe('Boost Configuration', () => {
  test('BC.1 Boost config has 3 tiers with correct percentages', () => {
    expect(boostConfig.tiers.standard).toBeDefined();
    expect(boostConfig.tiers.premium).toBeDefined();
    expect(boostConfig.tiers.elite).toBeDefined();
    
    expect(boostConfig.tiers.standard.feePercent).toBe(10);
    expect(boostConfig.tiers.premium.feePercent).toBe(15);
    expect(boostConfig.tiers.elite.feePercent).toBe(20);
  });

  test('BC.2 Each tier has correct priority scores', () => {
    expect(boostConfig.tiers.standard.priorityScore).toBe(1);
    expect(boostConfig.tiers.premium.priorityScore).toBe(2);
    expect(boostConfig.tiers.elite.priorityScore).toBe(3);
  });

  test('BC.3 Each tier has features array', () => {
    expect(boostConfig.tiers.standard.features.length).toBeGreaterThanOrEqual(3);
    expect(boostConfig.tiers.premium.features.length).toBeGreaterThanOrEqual(5);
    expect(boostConfig.tiers.elite.features.length).toBeGreaterThanOrEqual(7);
  });

  test('BC.4 GET /api/boost/config returns all tiers', async () => {
    const res = await request(app).get('/api/boost/config');
    expect(res.status).toBe(200);
    expect(res.body.tiers).toBeDefined();
    expect(res.body.tiers.standard).toBeDefined();
    expect(res.body.tiers.premium).toBeDefined();
    expect(res.body.tiers.elite).toBeDefined();
    expect(res.body.minDurationDays).toBe(7);
    expect(res.body.maxDurationDays).toBe(30);
    expect(res.body.defaultDurationDays).toBe(14);
  });
});

// ============================================================
// TEST 2: Boost Fee Calculation
// ============================================================
describe('Boost Fee Calculation', () => {
  test('BF.1 Standard boost: 10% of $100 = $10 for 14 days', () => {
    const result = calculateBoostFee(100, 'standard', 14);
    expect(result.fee).toBe(10);
    expect(result.tier).toBe('Standard Boost');
    expect(result.boostFeePercent).toBe(10);
    expect(result.priorityScore).toBe(1);
  });

  test('BF.2 Premium boost: 15% of $100 = $15 for 14 days', () => {
    const result = calculateBoostFee(100, 'premium', 14);
    expect(result.fee).toBe(15);
    expect(result.tier).toBe('Premium Boost');
    expect(result.boostFeePercent).toBe(15);
    expect(result.priorityScore).toBe(2);
  });

  test('BF.3 Elite boost: 20% of $100 = $20 for 14 days', () => {
    const result = calculateBoostFee(100, 'elite', 14);
    expect(result.fee).toBe(20);
    expect(result.tier).toBe('Elite Boost');
    expect(result.boostFeePercent).toBe(20);
    expect(result.priorityScore).toBe(3);
  });

  test('BF.4 Fee scales with price: $500 item at premium = $75', () => {
    const result = calculateBoostFee(500, 'premium', 14);
    expect(result.fee).toBe(75);
  });

  test('BF.5 Fee scales with duration: $100 at standard for 7 days = $5', () => {
    const result = calculateBoostFee(100, 'standard', 7);
    expect(result.fee).toBe(5);
  });

  test('BF.6 Fee scales with duration: $100 at standard for 30 days = $21.43', () => {
    const result = calculateBoostFee(100, 'standard', 30);
    // Daily rate = $10/14 = $0.714, for 30 days = $21.43
    expect(result.fee).toBeCloseTo(21.43, 1);
  });

  test('BF.7 Invalid tier defaults to standard', () => {
    const result = calculateBoostFee(100, 'invalid', 14);
    expect(result.fee).toBe(10);
    expect(result.tier).toBe('Standard Boost');
  });
});

// ============================================================
// TEST 3: Listing Creation with Boost
// ============================================================
describe('Listing Creation with Boost', () => {
  test('LC.1 Create listing with standard boost', async () => {
    const res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Standard',
      price: 100,
      boostTier: 'standard',
      boostDuration: 14,
    });
    
    expect(res.status).toBe(201);
    expect(res.body.boost).toBeDefined();
    expect(res.body.boost.active).toBe(true);
    expect(res.body.boost.tier).toBe('standard');
    expect(res.body.boost.fee).toBe(10);
    expect(res.body.boost.durationDays).toBe(14);
    expect(res.body.boost.startDate).toBeDefined();
    expect(res.body.boost.endDate).toBeDefined();
  });

  test('LC.2 Create listing with premium boost (default recommended)', async () => {
    const res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Premium',
      price: 200,
      boostTier: 'premium',
      boostDuration: 14,
    });
    
    expect(res.status).toBe(201);
    expect(res.body.boost.active).toBe(true);
    expect(res.body.boost.tier).toBe('premium');
    expect(res.body.boost.fee).toBe(30); // 15% of $200
  });

  test('LC.3 Create listing with elite boost', async () => {
    const res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Elite',
      price: 500,
      boostTier: 'elite',
      boostDuration: 14,
    });
    
    expect(res.status).toBe(201);
    expect(res.body.boost.active).toBe(true);
    expect(res.body.boost.tier).toBe('elite');
    expect(res.body.boost.fee).toBe(100); // 20% of $500
  });

  test('LC.4 Create listing without boost', async () => {
    const res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test No Boost',
      price: 100,
    });
    
    expect(res.status).toBe(201);
    expect(res.body.boost.active).toBe(false);
    expect(res.body.boost.tier).toBe('');
    expect(res.body.boost.fee).toBe(0);
  });

  test('LC.5 Invalid boost tier is ignored', async () => {
    const res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Invalid',
      price: 100,
      boostTier: 'invalid',
    });
    
    expect(res.status).toBe(201);
    expect(res.body.boost.active).toBe(false);
  });
});

// ============================================================
// TEST 4: Revenue Split with Boost
// ============================================================
describe('Revenue Split with Boost', () => {
  test('RS.1 $100 item with standard boost: platform gets $18, seller gets $82', async () => {
    // Create boosted listing
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Revenue Standard',
      price: 100,
      boostTier: 'standard',
      quantity: 5,
    });
    
    const listingId = listingRes.body._id;
    
    // Buy the item
    const buyRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    expect(buyRes.status).toBe(201);
    
    const txn = buyRes.body;
    const pb = txn.paymentBreakdown;
    
    // Platform fee: 8% of $100 = $8
    expect(pb.platformFee).toBe(8);
    
    // Boost fee: 10% of $100 = $10
    expect(pb.boostFee).toBe(10);
    expect(pb.boostTier).toBe('standard');
    
    // Seller earnings: $100 - $8 (platform) - $10 (boost) = $82
    expect(pb.sellerEarnings).toBe(82);
    
    // Total platform revenue: $8 + $10 = $18
    const totalPlatformRevenue = pb.platformFee + pb.boostFee;
    expect(totalPlatformRevenue).toBe(18);
  });

  test('RS.2 $200 item with premium boost: platform gets $46, seller gets $154', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Revenue Premium',
      price: 200,
      boostTier: 'premium',
      quantity: 5,
    });
    
    const listingId = listingRes.body._id;
    
    const buyRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const pb = buyRes.body.paymentBreakdown;
    
    // Platform fee: 8% of $200 = $16
    expect(pb.platformFee).toBe(16);
    
    // Boost fee: 15% of $200 = $30
    expect(pb.boostFee).toBe(30);
    
    // Seller earnings: $200 - $16 - $30 = $154
    expect(pb.sellerEarnings).toBe(154);
    
    // Total platform revenue: $16 + $30 = $46
    expect(pb.platformFee + pb.boostFee).toBe(46);
  });

  test('RS.3 $500 item with elite boost: platform gets $140, seller gets $360', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Revenue Elite',
      price: 500,
      boostTier: 'elite',
      quantity: 5,
    });
    
    const listingId = listingRes.body._id;
    
    const buyRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const pb = buyRes.body.paymentBreakdown;
    
    // Platform fee: 8% of $500 = $40
    expect(pb.platformFee).toBe(40);
    
    // Boost fee: 20% of $500 = $100
    expect(pb.boostFee).toBe(100);
    
    // Seller earnings: $500 - $40 - $100 = $360
    expect(pb.sellerEarnings).toBe(360);
    
    // Total platform revenue: $40 + $100 = $140
    expect(pb.platformFee + pb.boostFee).toBe(140);
  });

  test('RS.4 Non-boosted item: platform gets 8%, seller gets 92%', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Revenue No Boost',
      price: 100,
      quantity: 5,
    });
    
    const listingId = listingRes.body._id;
    
    const buyRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const pb = buyRes.body.paymentBreakdown;
    
    expect(pb.platformFee).toBe(8);
    expect(pb.boostFee).toBe(0);
    expect(pb.sellerEarnings).toBe(92);
  });
});

// ============================================================
// TEST 5: Boost API Endpoints
// ============================================================
describe('Boost API Endpoints', () => {
  test('BE.1 POST /api/listings/:id/boost activates boost', async () => {
    // Create listing without boost
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Activate',
      price: 100,
    });
    
    const listingId = listingRes.body._id;
    
    // Activate boost via API
    const boostRes = await request(app)
      .post(`/api/listings/${listingId}/boost`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ tier: 'premium', durationDays: 14 });
    
    expect(boostRes.status).toBe(200);
    expect(boostRes.body.boost.active).toBe(true);
    expect(boostRes.body.boost.tier).toBe('premium');
    expect(boostRes.body.fee).toBe(15);
  });

  test('BE.2 Cannot boost already boosted listing', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Already Boosted',
      price: 100,
      boostTier: 'standard',
    });
    
    const listingId = listingRes.body._id;
    
    const boostRes = await request(app)
      .post(`/api/listings/${listingId}/boost`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ tier: 'premium' });
    
    expect(boostRes.status).toBe(400);
    expect(boostRes.body.message).toContain('already boosted');
  });

  test('BE.3 POST /api/listings/:id/deactivate-boost deactivates boost', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Deactivate',
      price: 100,
      boostTier: 'premium',
    });
    
    const listingId = listingRes.body._id;
    
    const deactivateRes = await request(app)
      .post(`/api/listings/${listingId}/deactivate-boost`)
      .set('Authorization', `Bearer ${sellerToken}`);
    
    expect(deactivateRes.status).toBe(200);
    
    // Verify boost is deactivated
    const listing = await Listing.findById(listingId);
    expect(listing.boost.active).toBe(false);
  });

  test('BE.4 Only seller can boost their own listing', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Auth',
      price: 100,
    });
    
    const listingId = listingRes.body._id;
    
    // Try to boost with buyer's token
    const boostRes = await request(app)
      .post(`/api/listings/${listingId}/boost`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ tier: 'premium' });
    
    expect(boostRes.status).toBe(403);
  });
});

// ============================================================
// TEST 6: Listing Edit with Boost
// ============================================================
describe('Listing Edit with Boost', () => {
  test('LE.1 Edit listing to add boost', async () => {
    // Create listing without boost
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Edit Add',
      price: 100,
    });
    
    const listingId = listingRes.body._id;
    
    // Edit to add boost
    const editRes = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('boostTier', 'premium')
      .field('boostDuration', '14');
    
    expect(editRes.status).toBe(200);
    expect(editRes.body.boost.active).toBe(true);
    expect(editRes.body.boost.tier).toBe('premium');
    expect(editRes.body.boost.fee).toBe(15);
  });

  test('LE.2 Edit listing to change boost tier', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Edit Change',
      price: 100,
      boostTier: 'standard',
    });
    
    const listingId = listingRes.body._id;
    
    // Change to elite
    const editRes = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('boostTier', 'elite')
      .field('boostDuration', '14');
    
    expect(editRes.status).toBe(200);
    expect(editRes.body.boost.tier).toBe('elite');
    expect(editRes.body.boost.fee).toBe(20);
  });

  test('LE.3 Edit listing to remove boost', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Edit Remove',
      price: 100,
      boostTier: 'premium',
    });
    
    const listingId = listingRes.body._id;
    
    // Remove boost
    const editRes = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('removeBoost', 'true');
    
    expect(editRes.status).toBe(200);
    expect(editRes.body.boost.active).toBe(false);
    expect(editRes.body.boost.fee).toBe(0);
  });

  test('LE.4 Edit listing price recalculates boost fee', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Edit Price',
      price: 100,
      boostTier: 'standard',
    });
    
    const listingId = listingRes.body._id;
    
    // Change price to $200
    const editRes = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('price', '200');
    
    expect(editRes.status).toBe(200);
    expect(editRes.body.price).toBe(200);
    // Boost fee should be recalculated: 10% of $200 = $20
    expect(editRes.body.boost.fee).toBe(20);
  });

  test('LE.5 Edit all listing fields including videoUrl', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Edit All',
      price: 100,
    });
    
    const listingId = listingRes.body._id;
    
    const editRes = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Updated Title')
      .field('description', 'Updated description')
      .field('price', '150')
      .field('category', 'Men')
      .field('brand', 'Nike')
      .field('size', 'L')
      .field('condition', 'Good')
      .field('color', 'Blue')
      .field('videoUrl', 'https://youtube.com/watch?v=test')
      .field('quantity', '10');
    
    expect(editRes.status).toBe(200);
    expect(editRes.body.title).toBe('Updated Title');
    expect(editRes.body.description).toBe('Updated description');
    expect(editRes.body.price).toBe(150);
    expect(editRes.body.category).toBe('Men');
    expect(editRes.body.brand).toBe('Nike');
    expect(editRes.body.size).toBe('L');
    expect(editRes.body.condition).toBe('Good');
    expect(editRes.body.color).toBe('Blue');
    expect(editRes.body.videoUrl).toBe('https://youtube.com/watch?v=test');
    expect(editRes.body.quantity).toBe(10);
  });
});

// ============================================================
// TEST 7: Seller Balance with Boost
// ============================================================
describe('Seller Balance with Boost', () => {
  test('SB.1 Seller pending balance reflects boost fee deduction', async () => {
    // Get initial balance
    const sellerBefore = await User.findById(sellerId);
    const initialPending = sellerBefore.balance.pending || 0;
    
    // Create and sell boosted item
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Balance',
      price: 100,
      boostTier: 'premium',
      quantity: 1,
    });
    
    const listingId = listingRes.body._id;
    
    await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    // Check seller balance
    const sellerAfter = await User.findById(sellerId);
    // Expected: $100 - $8 (platform) - $15 (boost) = $77
    const expectedIncrease = 77;
    expect(sellerAfter.balance.pending).toBe(initialPending + expectedIncrease);
  });
});

// ============================================================
// TEST 8: Multi-Seller Orders with Mixed Boost
// ============================================================
describe('Multi-Seller Orders with Mixed Boost', () => {
  let seller2Token, seller2Id, seller3Token, seller3Id;
  
  beforeAll(async () => {
    // Create additional sellers
    const { user: s2, token: st2 } = await createUser('BoostSeller2', mkEmail('seller2'));
    seller2Id = s2._id;
    seller2Token = st2;
    
    const { user: s3, token: st3 } = await createUser('BoostSeller3', mkEmail('seller3'));
    seller3Id = s3._id;
    seller3Token = st3;
  });
  
  test('MS.1 Batch order: 3 sellers - one with each boost tier, verify correct splits', async () => {
    // Seller 1: Standard boost (10%) - $100 item
    const listing1Res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Multi Standard',
      price: 100,
      boostTier: 'standard',
      quantity: 5,
    });
    
    // Seller 2: Premium boost (15%) - $200 item
    const listing2Res = await createListingWithBoost(seller2Token, {
      title: 'Boost Test Multi Premium',
      price: 200,
      boostTier: 'premium',
      quantity: 5,
    });
    
    // Seller 3: No boost - $150 item
    const listing3Res = await createListingWithBoost(seller3Token, {
      title: 'Boost Test Multi No Boost',
      price: 150,
      quantity: 5,
    });
    
    // Get initial balances
    const seller1Before = await User.findById(sellerId);
    const seller2Before = await User.findById(seller2Id);
    const seller3Before = await User.findById(seller3Id);
    
    // Buy from all 3 sellers
    const buy1 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing1Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const buy2 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing2Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const buy3 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing3Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    // Verify Seller 1 (Standard boost): $100 - $8 (8%) - $10 (10%) = $82
    const pb1 = buy1.body.paymentBreakdown;
    expect(pb1.platformFee).toBe(8);
    expect(pb1.boostFee).toBe(10);
    expect(pb1.sellerEarnings).toBe(82);
    
    // Verify Seller 2 (Premium boost): $200 - $16 (8%) - $30 (15%) = $154
    const pb2 = buy2.body.paymentBreakdown;
    expect(pb2.platformFee).toBe(16);
    expect(pb2.boostFee).toBe(30);
    expect(pb2.sellerEarnings).toBe(154);
    
    // Verify Seller 3 (No boost): $150 - $12 (8%) - $0 = $138
    const pb3 = buy3.body.paymentBreakdown;
    expect(pb3.platformFee).toBe(12);
    expect(pb3.boostFee).toBe(0);
    expect(pb3.sellerEarnings).toBe(138);
    
    // Verify seller balances
    const seller1After = await User.findById(sellerId);
    const seller2After = await User.findById(seller2Id);
    const seller3After = await User.findById(seller3Id);
    
    expect(seller1After.balance.pending).toBe(seller1Before.balance.pending + 82);
    expect(seller2After.balance.pending).toBe(seller2Before.balance.pending + 154);
    expect(seller3After.balance.pending).toBe(seller3Before.balance.pending + 138);
    
    // Total platform revenue: ($8+$10) + ($16+$30) + $12 = $76
    const totalPlatformRevenue = (pb1.platformFee + pb1.boostFee) + 
                                  (pb2.platformFee + pb2.boostFee) + 
                                  (pb3.platformFee + pb3.boostFee);
    expect(totalPlatformRevenue).toBe(76);
  });
  
  test('MS.2 Individual purchases simulating batch (mixed boost items)', async () => {
    // Create listings from different sellers
    const listing1Res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Batch Elite Sim',
      price: 300,
      boostTier: 'elite',
      quantity: 3,
    });
    
    const listing2Res = await createListingWithBoost(seller2Token, {
      title: 'Boost Test Batch No Boost Sim',
      price: 100,
      quantity: 3,
    });
    
    // Purchase individually (simulating batch)
    const buy1 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing1Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const buy2 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing2Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    expect(buy1.status).toBe(201);
    expect(buy2.status).toBe(201);
    
    // Seller 1 (Elite boost): $300 - $24 (8%) - $60 (20%) = $216
    expect(buy1.body.paymentBreakdown.platformFee).toBe(24);
    expect(buy1.body.paymentBreakdown.boostFee).toBe(60);
    expect(buy1.body.paymentBreakdown.sellerEarnings).toBe(216);
    
    // Seller 2 (No boost): $100 - $8 (8%) - $0 = $92
    expect(buy2.body.paymentBreakdown.platformFee).toBe(8);
    expect(buy2.body.paymentBreakdown.boostFee).toBe(0);
    expect(buy2.body.paymentBreakdown.sellerEarnings).toBe(92);
    
    // Total platform revenue: ($24+$60) + $8 = $92
    const totalPlatform = (buy1.body.paymentBreakdown.platformFee + buy1.body.paymentBreakdown.boostFee) +
                          (buy2.body.paymentBreakdown.platformFee + buy2.body.paymentBreakdown.boostFee);
    expect(totalPlatform).toBe(92);
  });
  
  test('MS.3 Same buyer buys multiple items from same seller with different boost tiers', async () => {
    // Seller creates 2 listings with different boost tiers
    const listing1Res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Same Seller Standard',
      price: 100,
      boostTier: 'standard',
      quantity: 3,
    });
    
    const listing2Res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Same Seller Elite',
      price: 200,
      boostTier: 'elite',
      quantity: 3,
    });
    
    const sellerBefore = await User.findById(sellerId);
    
    // Buy both items
    const buy1 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing1Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const buy2 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing2Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    // Item 1: $100 - $8 - $10 = $82
    // Item 2: $200 - $16 - $40 = $144
    // Total seller earnings: $82 + $144 = $226
    const sellerAfter = await User.findById(sellerId);
    expect(sellerAfter.balance.pending).toBe(sellerBefore.balance.pending + 82 + 144);
    
    // Total platform: ($8+$10) + ($16+$40) = $74
    const totalPlatform = (buy1.body.paymentBreakdown.platformFee + buy1.body.paymentBreakdown.boostFee) +
                          (buy2.body.paymentBreakdown.platformFee + buy2.body.paymentBreakdown.boostFee);
    expect(totalPlatform).toBe(74);
  });
});

// ============================================================
// TEST 9: Returns and Refunds with Boost
// ============================================================
describe('Returns and Refunds with Boost', () => {
  test('RF.1 Boosted item transaction has correct boost data for return calculations', async () => {
    // Create boosted listing
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Return Data',
      price: 100,
      boostTier: 'premium',
      quantity: 5,
    });
    
    const listingId = listingRes.body._id;
    
    // Buy the item
    const buyRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const txnId = buyRes.body._id;
    const pb = buyRes.body.paymentBreakdown;
    
    // Verify transaction has correct boost data for return calculations
    expect(pb.boostFee).toBe(15); // 15% of $100
    expect(pb.boostTier).toBe('premium');
    expect(pb.platformFee).toBe(8); // 8% of $100
    expect(pb.sellerEarnings).toBe(77); // $100 - $8 - $15
    
    // Verify transaction record stores boost info
    const txn = await Transaction.findById(txnId);
    expect(txn.paymentBreakdown.boostFee).toBe(15);
    expect(txn.paymentBreakdown.boostTier).toBe('premium');
    
    // Verify math: itemPrice = platformFee + boostFee + sellerEarnings
    expect(pb.subtotal).toBe(pb.platformFee + pb.boostFee + pb.sellerEarnings);
  });
  
  test('RF.2 Cancel before shipment: full refund, no boost fee charged', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Cancel',
      price: 100,
      boostTier: 'elite',
      quantity: 5,
    });
    
    const listingId = listingRes.body._id;
    const sellerBefore = await User.findById(sellerId);
    
    // Buy the item
    const buyRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const txnId = buyRes.body._id;
    
    // Cancel before shipment
    const cancelRes = await request(app)
      .post(`/api/orders/${txnId}/cancel`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Changed mind' });
    
    expect(cancelRes.status).toBe(200);
    
    // After cancel: seller loses earnings, buyer gets full refund
    const sellerAfterCancel = await User.findById(sellerId);
    // Seller should be back to original balance
    expect(sellerAfterCancel.balance.pending).toBe(sellerBefore.balance.pending);
    
    // Verify transaction is cancelled
    const txn = await Transaction.findById(txnId);
    expect(txn.status).toMatch(/cancel/);
  });
  
  test('RF.3 Multiple purchases with mixed boost - verify each transaction breakdown', async () => {
    // Create 3 listings: one with boost, one without, one with different boost
    const listing1Res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Multi Breakdown 1',
      price: 100,
      boostTier: 'standard',
      quantity: 3,
    });
    
    const listing2Res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Multi Breakdown 2',
      price: 150,
      boostTier: 'premium',
      quantity: 3,
    });
    
    const listing3Res = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Multi Breakdown 3',
      price: 200,
      quantity: 3,
    });
    
    // Buy all 3 items
    const buy1 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing1Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const buy2 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing2Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const buy3 = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listing3Res.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    // Item 1 (Standard 10%): $100 - $8 - $10 = $82
    const pb1 = buy1.body.paymentBreakdown;
    expect(pb1.platformFee).toBe(8);
    expect(pb1.boostFee).toBe(10);
    expect(pb1.sellerEarnings).toBe(82);
    
    // Item 2 (Premium 15%): $150 - $12 - $22.50 = $115.50
    const pb2 = buy2.body.paymentBreakdown;
    expect(pb2.platformFee).toBe(12);
    expect(pb2.boostFee).toBe(22.50);
    expect(pb2.sellerEarnings).toBe(115.50);
    
    // Item 3 (No boost): $200 - $16 - $0 = $184
    const pb3 = buy3.body.paymentBreakdown;
    expect(pb3.platformFee).toBe(16);
    expect(pb3.boostFee).toBe(0);
    expect(pb3.sellerEarnings).toBe(184);
    
    // Total platform revenue: ($8+$10) + ($12+$22.50) + $16 = $68.50
    const totalPlatform = (pb1.platformFee + pb1.boostFee) + 
                          (pb2.platformFee + pb2.boostFee) + 
                          (pb3.platformFee + pb3.boostFee);
    expect(totalPlatform).toBe(68.50);
    
    // Total seller earnings: $82 + $115.50 + $184 = $381.50
    const totalSeller = pb1.sellerEarnings + pb2.sellerEarnings + pb3.sellerEarnings;
    expect(totalSeller).toBe(381.50);
  });
});

// ============================================================
// TEST 10: Platform Revenue Verification
// ============================================================
describe('Platform Revenue Verification', () => {
  test('PR.1 Platform gets boost fee IN ADDITION to 8% platform fee', async () => {
    const listingRes = await createListingWithBoost(sellerToken, {
      title: 'Boost Test Platform Revenue',
      price: 500,
      boostTier: 'elite',
      quantity: 5,
    });
    
    const buyRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        listingId: listingRes.body._id,
        shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
        buyerCountry: 'US',
      });
    
    const pb = buyRes.body.paymentBreakdown;
    
    // Platform fee: 8% of $500 = $40
    expect(pb.platformFee).toBe(40);
    
    // Boost fee: 20% of $500 = $100
    expect(pb.boostFee).toBe(100);
    
    // Total platform revenue: $40 + $100 = $140
    const totalPlatformRevenue = pb.platformFee + pb.boostFee;
    expect(totalPlatformRevenue).toBe(140);
    
    // Seller earnings: $500 - $40 - $100 = $360
    expect(pb.sellerEarnings).toBe(360);
    
    // Verify: itemPrice = platformFee + boostFee + sellerEarnings
    expect(pb.subtotal).toBe(pb.platformFee + pb.boostFee + pb.sellerEarnings);
  });
  
  test('PR.2 Revenue math: itemPrice = platformFee + boostFee + sellerEarnings', async () => {
    const testCases = [
      { price: 50, tier: 'standard', expectedPlatform: 4, expectedBoost: 5, expectedSeller: 41 },
      { price: 100, tier: 'premium', expectedPlatform: 8, expectedBoost: 15, expectedSeller: 77 },
      { price: 250, tier: 'elite', expectedPlatform: 20, expectedBoost: 50, expectedSeller: 180 },
      { price: 100, tier: null, expectedPlatform: 8, expectedBoost: 0, expectedSeller: 92 },
    ];
    
    for (const tc of testCases) {
      const listingRes = await createListingWithBoost(sellerToken, {
        title: `Boost Test Revenue Math ${tc.tier || 'none'}`,
        price: tc.price,
        boostTier: tc.tier,
        quantity: 5,
      });
      
      const buyRes = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId: listingRes.body._id,
          shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' },
          buyerCountry: 'US',
        });
      
      const pb = buyRes.body.paymentBreakdown;
      
      expect(pb.platformFee).toBe(tc.expectedPlatform);
      expect(pb.boostFee).toBe(tc.expectedBoost);
      expect(pb.sellerEarnings).toBe(tc.expectedSeller);
      
      // Verify math: itemPrice = platformFee + boostFee + sellerEarnings
      expect(pb.subtotal).toBe(pb.platformFee + pb.boostFee + pb.sellerEarnings);
    }
  });
});
