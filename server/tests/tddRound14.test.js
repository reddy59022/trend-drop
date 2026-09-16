/* TDD Round 14 RED tests — systematic sweep: NO endpoint may return 500 for
 * malformed body ids, and NO create-path may persist orphans for valid-but-
 * nonexistent body ids. Table-driven probes; any 500 is a failing bug.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Referral = require('../models/Referral');
const LoyaltyProgram = require('../models/LoyaltyProgram');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const RUN = `r14_${Date.now()}`;
const US = { fullName: 'R14', street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' };
const U = [];
const L = [];
const GHOST = () => new mongoose.Types.ObjectId().toString();

let user;
let token;
let listing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  user = await User.create({
    name: 'R14 User', email: `r14_${RUN}@test.com`, password: 'password123',
    emailVerified: true, authProvider: 'email', country: 'US', currency: 'USD',
    shippingAddress: { ...US },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
  });
  U.push(user._id);
  token = jwt.sign({ id: user._id }, SECRET, { expiresIn: '30d' });
  listing = await Listing.create({
    seller: user._id, title: 'R14 Item', description: 'd', price: 50,
    category: 'Men', condition: 'New with tags', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5,
  });
  L.push(listing._id);
});

afterAll(async () => {
  await LoyaltyProgram.deleteMany({ user: { $in: U } });
  await Referral.deleteMany({ referrer: { $in: U } });
  await Listing.deleteMany({ _id: { $in: L } });
  await User.deleteMany({ _id: { $in: U } });
});

const post = (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);

// Each probe: [label, url, body]. The invariant is status < 500 — a 400/403/404
// is an acceptable rejection, a 500 means an unhandled crash on bad input.
// Built lazily (function) because the comments probe needs the seeded listing.
const probes = () => [
  ['escrow initiate garbage transactionId', '/api/escrow/initiate', { transactionId: 'garbage', amount: 10 }],
  ['escrow dispute garbage transactionId', '/api/escrow/dispute', { transactionId: 'garbage', reason: 'x', evidence: 'y' }],
  ['returns garbage transactionId', '/api/returns', { transactionId: 'garbage', reason: 'Not as described', description: 'r14' }],
  ['shipping generate-label garbage transactionId', '/api/shipping/generate-label', { transactionId: 'garbage', carrier: 'usps' }],
  ['shipping confirm-received garbage transactionId', '/api/shipping/confirm-received', { transactionId: 'garbage' }],
  ['shipping-insurance purchase garbage transactionId', '/api/shipping-insurance/purchase', { transactionId: 'garbage', coverageType: 'standard' }],
  ['fraud check garbage listingId', '/api/fraud/check', { listingId: 'garbage', amount: 10 }],
  ['messages garbage listingId + recipientId', '/api/messages', { listingId: 'garbage', recipientId: 'garbage', text: 'hi' }],
  ['offers garbage listingId', '/api/offers', { listingId: 'garbage', amount: 30 }],
  ['cart items garbage listingId', '/api/cart/items', { listingId: 'garbage', quantity: 1 }],
  ['auctions garbage listingId', '/api/auctions', { listingId: 'garbage', startTime: new Date().toISOString(), endTime: new Date(Date.now() + 864e5).toISOString() }],
  ['loyalty earn garbage listingId', '/api/loyalty/earn', { reason: 'purchase', purchaseAmount: 50, listingId: 'garbage' }],
  ['comments garbage parentId', '/api/comments/R14_LISTING', { text: 'r14 comment', parentId: 'garbage' }],
  ['ar-showrooms garbage listingId', '/api/ar-showrooms', { listingId: 'garbage', position: { x: 0, y: 0, z: 0 }, scale: 1 }],
  ['live-events garbage listingIds', '/api/live-events', { title: 'r14', description: 'd', listingIds: ['garbage'], startTime: new Date().toISOString(), endTime: new Date(Date.now() + 36e5).toISOString(), discount: 10 }],
  ['offer-sharing bundle garbage ids', '/api/offer-sharing/bundle', { listingIds: ['garbage'], buyerId: 'garbage' }],
];

describe('R14.1 no endpoint 500s on malformed body ids', () => {
  test.each(probes())('%s -> < 500', async (_label, url, body) => {
    const resolved = url.replace('R14_LISTING', listing._id.toString());
    const res = await post(resolved, body);
    expect(res.status).toBeLessThan(500);
  });
});

describe('R14.2 ghost body ids do not persist orphans', () => {
  test('loyalty earn with ghost listingId -> < 500, no pointsHistory entry', async () => {
    const before = await LoyaltyProgram.findOne({ user: user._id });
    const beforeLen = before ? (before.pointsHistory || []).length : 0;
    const res = await post('/api/loyalty/earn', { reason: 'purchase', purchaseAmount: 50, listingId: GHOST() });
    expect(res.status).toBeLessThan(500);
    const after = await LoyaltyProgram.findOne({ user: user._id });
    expect(after ? (after.pointsHistory || []).length : 0).toBe(beforeLen);
  });

  test('referral apply with ghost userId -> < 500, uses not inflated', async () => {
    await post('/api/referrals/generate');
    const referral = await Referral.findOne({ referrer: user._id, status: 'active' });
    expect(referral).toBeTruthy();
    const res = await request(app).post('/api/referrals/apply').send({ code: referral.code, userId: GHOST() });
    expect(res.status).toBeLessThan(500);
    const reloaded = await Referral.findById(referral._id);
    expect(reloaded.uses).toBe(0);
  });
});
