/**
 * TDD Round 31 — RED tests first (business gaps proven by failing tests).
 *
 * Gaps found by cross-checking the E2E + client + server suites against the
 * business contract (BUSINESS_RULES.md / README.md):
 *
 *   R31-1  Recently-Viewed recency is dead (BUSINESS_RULES v38.0):
 *          POST /api/recently-viewed/:listingId answers "Already viewed"
 *          WITHOUT refreshing the stored viewedAt timestamp. Re-visiting an
 *          item therefore never moves it back to the front of the history —
 *          the "Recently Viewed" page shows FIRST-view order forever, which
 *          defeats the feature's purpose. The existing suite cannot catch it:
 *          v38.2 only asserts the 200 "Already viewed" response and v38.10
 *          only asserts the first element is populated.
 *
 *   R31-2  Review-time integrity (BUSINESS_RULES order lifecycle: pending →
 *          paid → shipped → delivered → completed; "You can only review items
 *          you have purchased"): POST /api/ratings only accepts transactions
 *          whose status is EXACTLY 'completed'. A transaction that is merely
 *          SHIPPED / IN TRANSIT is not a completed purchase, yet the rating
 *          goes through — while genuinely DELIVERED items (the normal case:
 *          most buyers never bother to confirm receipt) are locked out of
 *          reviewing entirely. Reviews must be a post-delivery signal.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const api = request(app);
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const RecentlyViewed = require('../models/RecentlyViewed');
const Rating = require('../models/Rating');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
const seed = `r31_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let seller, sellerToken;
let buyer, buyerToken;
let listingA, listingB;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  seller = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'R31 Seller',
    email: `${seed}s@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  sellerToken = jwt.sign({ id: seller._id }, secret, { expiresIn: '1h' });

  buyer = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'R31 Buyer',
    email: `${seed}b@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
  });
  buyerToken = jwt.sign({ id: buyer._id }, secret, { expiresIn: '1h' });

  listingA = await Listing.create({
    seller: seller._id, title: 'R31 Item A', description: 'recency probe A',
    price: 50, category: 'Men', condition: 'Good', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5,
  });
  listingB = await Listing.create({
    seller: seller._id, title: 'R31 Item B', description: 'recency probe B',
    price: 60, category: 'Men', condition: 'Good', quantity: 5,
    available: true, sold: false, status: 'active', shipsFrom: 'US',
    currency: 'USD', weight: 0.5,
  });
});

afterAll(async () => {
  try { await RecentlyViewed.deleteMany({ userId: buyer._id }); } catch (_) {}
  try { await Rating.deleteMany({ reviewer: buyer._id }); } catch (_) {}
  try { await Transaction.deleteMany({ buyer: buyer._id }); } catch (_) {}
  try { await Listing.deleteMany({ seller: seller._id }); } catch (_) {}
  try { await User.deleteMany({ _id: { $in: [seller._id, buyer._id] } }); } catch (_) {}
});

const view = (listingId) =>
  api.post(`/api/recently-viewed/${listingId}`).set('Authorization', `Bearer ${buyerToken}`);

const history = () =>
  api.get('/api/recently-viewed').set('Authorization', `Bearer ${buyerToken}`);

// ============================================================
// R31-1 — Recently-Viewed recency
// ============================================================
describe('R31-1: recently-viewed history must be ordered by viewing recency', () => {
  test('sanity: viewing A then B lists B first (recency order works for first views)', async () => {
    await view(listingA._id).expect(201);
    await wait(30);
    await view(listingB._id).expect(201);

    const res = await history().expect(200);
    const ids = res.body.items.map((i) => String(i._id));
    expect(ids).toEqual([String(listingB._id), String(listingA._id)]);
  });

  test('R31-1a: re-viewing item A moves it back to the front of the history', async () => {
    await wait(30);
    // The buyer re-visits item A (e.g. from a search result or a push).
    const revisit = await view(listingA._id);
    // The API contract stays compatible with v38.2: a re-view is a 200
    // idempotent acknowledgement, not a duplicate record.
    expect(revisit.status).toBe(200);

    const res = await history().expect(200);
    const ids = res.body.items.map((i) => String(i._id));
    // BUG (RED): the order is still [B, A] because viewedAt was never bumped.
    expect(ids).toEqual([String(listingA._id), String(listingB._id)]);
  });

  test('R31-1b: re-viewing an item refreshes its viewedAt timestamp', async () => {
    const before = await RecentlyViewed.findOne({ userId: buyer._id, listingId: listingB._id });
    expect(before).toBeTruthy();
    const staleViewedAt = new Date(before.viewedAt);

    await wait(30);
    await view(listingB._id);

    const after = await RecentlyViewed.findOne({ userId: buyer._id, listingId: listingB._id });
    // BUG (RED): viewedAt still holds the FIRST-view timestamp.
    expect(new Date(after.viewedAt).getTime()).toBeGreaterThan(staleViewedAt.getTime());
  });
});

// ============================================================
// R31-2 — Review-time integrity
// ============================================================
const mkTxn = async (listing, status) =>
  Transaction.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    quantity: 1,
    itemPrice: listing.price,
    currency: 'USD',
    paymentBreakdown: {
      subtotal: listing.price,
      shippingCost: 5,
      buyerProtectionFee: Math.round(listing.price * 5) / 100,
      totalPaid: listing.price + 5,
      platformFee: 4,
      sellerEarnings: listing.price - 4,
    },
    shippingAddress: { fullName: 'R31 Buyer', street1: '1 St', city: 'C', state: 'S', postalCode: '0', country: 'US' },
    status,
  });

const postRating = (listingId, body = {}) =>
  api
    .post('/api/ratings')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ listingId: String(listingId), rating: 5, review: 'R31 probe', ...body });

describe('R31-2: buyers can review delivered items, not items still in transit', () => {
  test('R31-2a: reviewing an item that is merely SHIPPED is rejected (400)', async () => {
    const shippedListing = await Listing.create({
      seller: seller._id, title: 'R31 Item Shipped', description: 'in transit',
      price: 45, category: 'Men', condition: 'Good', quantity: 5,
      available: true, sold: false, status: 'active', shipsFrom: 'US',
      currency: 'USD', weight: 0.5,
    });
    await mkTxn(shippedListing, 'shipped');

    // BUG (RED): 201 — the buyer can leave a permanent public rating on an
    // item that has not even been delivered yet.
    const res = await postRating(shippedListing._id);
    expect(res.status).toBe(400);
  });

  test('R31-2b: reviewing an item that is IN TRANSIT is rejected (400)', async () => {
    const transitListing = await Listing.create({
      seller: seller._id, title: 'R31 Item Transit', description: 'in transit',
      price: 55, category: 'Men', condition: 'Good', quantity: 5,
      available: true, sold: false, status: 'active', shipsFrom: 'US',
      currency: 'USD', weight: 0.5,
    });
    await mkTxn(transitListing, 'in_transit');

    const res = await postRating(transitListing._id);
    expect(res.status).toBe(400);
  });

  test('R31-2c: a DELIVERED item can legitimately be reviewed (201)', async () => {
    const deliveredListing = await Listing.create({
      seller: seller._id, title: 'R31 Item Delivered', description: 'delivered',
      price: 65, category: 'Men', condition: 'Good', quantity: 5,
      available: true, sold: false, status: 'active', shipsFrom: 'US',
      currency: 'USD', weight: 0.5,
    });
    await mkTxn(deliveredListing, 'delivered');

    const res = await postRating(deliveredListing._id);
    expect(res.status).toBe(201);
    expect(res.body.rating).toBe(5);
  });
});
