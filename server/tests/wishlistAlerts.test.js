/**
 * TDD round (feature): wishlisters get price-drop and relist/restock alerts.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Wishlist = require('../models/Wishlist');
const PriceHistory = require('../models/PriceHistory');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const tokenFor = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
const created = { users: [], listings: [] };

const makeUser = async (label) => {
  const user = await User.create({
    name: `${label} User`,
    email: `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    shippingAddress: { fullName: label, street1: '1 Main St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  created.users.push(user._id);
  return user;
};

const makeListing = async (seller, overrides = {}) => {
  const listing = await Listing.create({
    seller: seller._id,
    title: 'Alert fixture item',
    description: 'Fixture',
    price: 100,
    originalPrice: 150,
    category: 'Women',
    condition: 'Good',
    images: ['https://example.com/item.jpg'],
    quantity: 1,
    available: true,
    sold: false,
    status: 'active',
    ...overrides,
  });
  created.listings.push(listing._id);
  return listing;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
});

afterAll(async () => {
  await PriceHistory.deleteMany({ listing: { $in: created.listings } });
  await Wishlist.deleteMany({ user: { $in: created.users } });
  await Listing.deleteMany({ _id: { $in: created.listings } });
  await User.deleteMany({ _id: { $in: created.users } });
  await mongoose.connection.close();
});

describe('WA.1 price-drop alerts for wishlisters', () => {
  test('a wishlist-only user is alerted, a liker+wishlister gets exactly one alert', async () => {
    const seller = await makeUser('wa_price_seller');
    const watcher = await makeUser('wa_price_watcher');
    const both = await makeUser('wa_price_both');
    const listing = await makeListing(seller, { likes: [both._id] });

    await Wishlist.create({ user: watcher._id, items: [{ listing: listing._id }] });
    await Wishlist.create({ user: both._id, items: [{ listing: listing._id }] });
    await Wishlist.create({ user: seller._id, items: [{ listing: listing._id }] });

    const res = await request(app)
      .put(`/api/listings/${listing._id}`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`)
      .send({ price: 80 });
    expect(res.status).toBe(200);

    const watcherAfter = await User.findById(watcher._id);
    expect(watcherAfter.notifications.filter((n) => n.type === 'priceDrop')).toHaveLength(1);

    const bothAfter = await User.findById(both._id);
    expect(bothAfter.notifications.filter((n) => n.type === 'priceDrop')).toHaveLength(1);

    const sellerAfter = await User.findById(seller._id);
    expect(sellerAfter.notifications.filter((n) => n.type === 'priceDrop')).toHaveLength(0);
  });

  test('a price increase does not alert wishlisters', async () => {
    const seller = await makeUser('wa_raise_seller');
    const watcher = await makeUser('wa_raise_watcher');
    const listing = await makeListing(seller);
    await Wishlist.create({ user: watcher._id, items: [{ listing: listing._id }] });

    const res = await request(app)
      .put(`/api/listings/${listing._id}`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`)
      .send({ price: 120 });
    expect(res.status).toBe(200);

    const after = await User.findById(watcher._id);
    expect(after.notifications.filter((n) => n.type === 'priceDrop')).toHaveLength(0);
  });
});

describe('WA.2 relisting alerts wishlisters that the item is back', () => {
  test('wishlisters of the sold item get a restock notification for the new listing', async () => {
    const seller = await makeUser('wa_relist_seller');
    const watcher = await makeUser('wa_relist_watcher');
    const listing = await makeListing(seller, { sold: true, available: false, quantity: 0 });
    await Wishlist.create({ user: watcher._id, items: [{ listing: listing._id }] });

    const res = await request(app)
      .post(`/api/listings/${listing._id}/relist`)
      .set('Authorization', `Bearer ${tokenFor(seller)}`)
      .send({ price: 90 });
    expect(res.status).toBe(200);
    const newId = res.body.listing._id;
    created.listings.push(newId);

    const after = await User.findById(watcher._id);
    const alerts = after.notifications.filter((n) => n.type === 'restock');
    expect(alerts).toHaveLength(1);
    expect(String(alerts[0].listing)).toBe(String(newId));
  });
});
