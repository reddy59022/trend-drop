/**
 * International shipping feature flag (Feature 2).
 *
 * INTERNATIONAL_SHOPPING_ENABLED (env) controls cross-country shipping:
 *   - flag ON  → items may ship between any countries
 *   - flag OFF → items may only ship WITHIN the seller's own country
 *
 * When the flag is OFF:
 *   - a listing must not declare shipping.international = true
 *   - checkout must reject an address in a different country than the seller
 *
 * Flag state is read lazily from process.env so suites can toggle it.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Cart = require('../models/Cart');
const jwt = require('jsonwebtoken');

const { isInternationalAllowed } = require('../config/shipping');
const { isInternationalShippingEnabled, getPublicFeatures } = require('../config/features');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const mkEmail = (p) => `${p}_intl_${Date.now()}@test.com`;

let seller, buyer, sellerToken, buyerToken;
const testUserIds = [];
const testListingIds = [];

const saveFlag = process.env.INTERNATIONAL_SHOPPING_ENABLED;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  seller = await User.create({
    name: 'IntlSeller', email: mkEmail('seller'), password: 'password123',
    emailVerified: true, country: 'US', currency: 'USD',
    shippingAddress: { fullName: 'IntlSeller', street1: '1 St', city: 'C', state: 'CA', postalCode: '90210', country: 'US' },
  });
  testUserIds.push(seller._id);
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });

  buyer = await User.create({
    name: 'IntlBuyer', email: mkEmail('buyer'), password: 'password123',
    emailVerified: true, country: 'US', currency: 'USD',
    shippingAddress: { fullName: 'IntlBuyer', street1: '2 St', city: 'C', state: 'NY', postalCode: '10001', country: 'US' },
  });
  testUserIds.push(buyer._id);
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  process.env.INTERNATIONAL_SHOPPING_ENABLED = saveFlag || '';
  await Transaction.deleteMany({ $or: [{ buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }, { listing: { $in: testListingIds } }] });
  await Payout.deleteMany({ $or: [{ seller: { $in: testUserIds } }, { listing: { $in: testListingIds } }] });
  await Cart.deleteMany({ user: { $in: testUserIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
});

describe('Feature 2 — International shipping flag', () => {
  beforeEach(() => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
  });

  test('INTL.1 flag defaults to DISABLED (domestic-only) and toggles from env', () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
    expect(isInternationalShippingEnabled()).toBe(false);

    process.env.INTERNATIONAL_SHOPPING_ENABLED = 'true';
    expect(isInternationalShippingEnabled()).toBe(true);

    process.env.INTERNATIONAL_SHOPPING_ENABLED = 'false';
    expect(isInternationalShippingEnabled()).toBe(false);
  });

  test('INTL.2 GET /api/config/features exposes the flag', async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
    const res = await request(app).get('/api/config/features');
    expect(res.status).toBe(200);
    expect(res.body.internationalShippingEnabled).toBe(false);
  });

  test('INTL.3 flag OFF: listing creation with internationalShipping=true is rejected (400)', async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Intl Flag Test')
      .field('description', 'international flag disabled')
      .field('price', '50')
      .field('category', 'Women')
      .field('condition', 'Good')
      .field('shipsFrom', 'US')
      .field('internationalShipping', 'true');

    expect(res.status).toBe(400);
    expect(res.body.message.toLowerCase()).toContain('international');
  });

  test('INTL.4 flag OFF: domestic-only listing creation succeeds (201)', async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Domestic Only Item')
      .field('description', 'domestic only')
      .field('price', '50')
      .field('category', 'Home')
      .field('condition', 'New with tags')
      .field('shipsFrom', 'US')
      .field('internationalShipping', 'false');

    expect(res.status).toBe(201);
    expect(res.body.listing.shipping.international).toBe(false);
    testListingIds.push(res.body.listing._id);
  });

  test('INTL.5 flag ON: listing creation with internationalShipping=true succeeds (201)', async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = 'true';
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('title', 'Intl Enabled Item')
      .field('description', 'international allowed')
      .field('price', '60')
      .field('category', 'Accessories')
      .field('condition', 'Good')
      .field('shipsFrom', 'US')
      .field('internationalShipping', 'true');

    expect(res.status).toBe(201);
    expect(res.body.listing.shipping.international).toBe(true);
    testListingIds.push(res.body.listing._id);
  });

  test('INTL.6 flag OFF: checkout from US buyer to DE address is rejected (400) with NO transaction created', async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
    const listing = await Listing.create({
      seller: seller._id, title: 'US Item', description: 'd', price: 40,
      category: 'Men', condition: 'Good', currency: 'USD',
      available: true, quantity: 5, shipsFrom: 'US',
    });
    testListingIds.push(listing._id);

    await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, quantity: 1 });

    const res = await request(app)
      .post('/api/cart/checkout')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ shippingAddress: { fullName: 'Buyer', street1: '1 St', city: 'Berlin', country: 'DE', postalCode: '10115' } });

    expect(res.status).toBe(400);
    expect(res.body.message.toLowerCase()).toContain('international');

    const txns = await Transaction.find({ listing: listing._id });
    expect(txns).toHaveLength(0);
  });

  test('INTL.7 flag OFF: same-country checkout succeeds (200)', async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
    const listing = await Listing.create({
      seller: seller._id, title: 'US Domestic Item', description: 'd', price: 30,
      category: 'Men', condition: 'Good', currency: 'USD',
      available: true, quantity: 5, shipsFrom: 'US',
    });
    testListingIds.push(listing._id);

    await Cart.deleteMany({ user: buyer._id });
    await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, quantity: 1 });

    const res = await request(app)
      .post('/api/cart/checkout')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ shippingAddress: { fullName: 'Buyer', street1: '1 St', city: 'NY', country: 'US', postalCode: '10001' } });

    expect(res.status).toBe(200);
  });

  test('INTL.8 flag ON: cross-country checkout succeeds (200)', async () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = 'true';
    const listing = await Listing.create({
      seller: seller._id, title: 'US to GB Item', description: 'd', price: 25,
      category: 'Women', condition: 'Good', currency: 'USD',
      available: true, quantity: 5, shipsFrom: 'US',
    });
    testListingIds.push(listing._id);

    await Cart.deleteMany({ user: buyer._id });
    await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, quantity: 1 });

    const res = await request(app)
      .post('/api/cart/checkout')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ shippingAddress: { fullName: 'Buyer', street1: '1 St', city: 'London', country: 'GB', postalCode: 'SW1' } });

    expect(res.status).toBe(200);
  });

  test('INTL.9 unit: isInternationalAllowed respects the flag; same-country is always allowed', () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
    expect(isInternationalAllowed('US', 'US')).toBe(true);
    expect(isInternationalAllowed('US', 'DE')).toBe(false);

    process.env.INTERNATIONAL_SHOPPING_ENABLED = 'true';
    expect(isInternationalAllowed('US', 'DE')).toBe(true);
    expect(isInternationalAllowed('DE', 'FR')).toBe(true);
  });

  test('INTL.10 getPublicFeatures is consistent with the live flag', () => {
    process.env.INTERNATIONAL_SHOPPING_ENABLED = 'true';
    expect(getPublicFeatures().internationalShippingEnabled).toBe(true);
    process.env.INTERNATIONAL_SHOPPING_ENABLED = '';
    expect(getPublicFeatures().internationalShippingEnabled).toBe(false);
  });
});
