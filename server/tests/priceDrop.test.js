// Price Drop Notification Tests
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Wishlist = require('../models/Wishlist');
const PriceHistory = require('../models/PriceHistory');
const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken;
let sellerId;
let likerToken;
let likerId;
let listingId;

describe('Price Drop Notifications', () => {
  beforeEach(async () => {
    const seed = `pd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const seller = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Price Seller',
      email: `${seed}seller@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
    });
    sellerId = seller._id;
    sellerToken = jwt.sign({ id: sellerId }, secret, { expiresIn: '1h' });

    const liker = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Price Liker',
      email: `${seed}liker@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
    });
    likerId = liker._id;
    likerToken = jwt.sign({ id: likerId }, secret, { expiresIn: '1h' });

    const listing = await Listing.create({
      seller: sellerId,
      title: 'Price Drop Item',
      description: 'Will drop price',
      price: 100,
      originalPrice: 150,
      category: 'Men',
      condition: 'Good',
      available: true,
      sold: false,
      status: 'active',
      likes: [likerId],
    });
    listingId = listing._id;

    // Likery has the listing in their wishlist
    await Wishlist.create({ user: likerId, items: [{ listing: listingId }] });
  });

  test('PD.1 - Liker is notified when seller drops the price', async () => {
    const res = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 75 });
    expect(res.status).toBe(200);

    const liker = await User.findById(likerId);
    const notification = liker.notifications.find(n => n.type === 'priceDrop');
    expect(notification).toBeDefined();
    expect(notification.listing.toString()).toBe(listingId.toString());
  });

  test('PD.2 - Notification contains old and new price', async () => {
    const res = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 60 });
    expect(res.status).toBe(200);

    const liker = await User.findById(likerId);
    const notification = liker.notifications.find(n => n.type === 'priceDrop');
    expect(notification).toBeDefined();
    expect(notification.message).toContain('100');
    expect(notification.message).toContain('60');
  });

  test('PD.3 - No notification when price increases', async () => {
    const res = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 120 });
    expect(res.status).toBe(200);

    const liker = await User.findById(likerId);
    const notification = liker.notifications.find(n => n.type === 'priceDrop');
    expect(notification).toBeUndefined();
  });

  test('PD.4 - Price drop is recorded in price history', async () => {
    const res = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 55 });
    expect(res.status).toBe(200);

    const history = await PriceHistory.find({ listing: listingId }).sort({ createdAt: 1 });
    expect(history.length).toBeGreaterThanOrEqual(1);
    const last = history[history.length - 1];
    expect(last.newPrice).toBe(55);
    expect(last.oldPrice).toBe(100);
  });

  test('PD.5 - Seller does not get their own price drop notification', async () => {
    const res = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 50 });
    expect(res.status).toBe(200);

    const seller = await User.findById(sellerId);
    const notification = seller.notifications.find(n => n.type === 'priceDrop');
    expect(notification).toBeUndefined();
  });

  test('PD.6 - Multiple likers all get notified on price drop', async () => {
    const liker2 = await User.create({
      _id: new mongoose.Types.ObjectId(),
      name: 'Price Liker 2',
      email: `pd2_${Date.now()}@test.com`,
      password: 'password123',
      emailVerified: true,
      authProvider: 'email',
      country: 'US',
      currency: 'USD',
    });
    await Listing.findByIdAndUpdate(listingId, { $push: { likes: liker2._id } });

    const res = await request(app)
      .put(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 45 });
    expect(res.status).toBe(200);

    const user1 = await User.findById(likerId);
    const user2 = await User.findById(liker2._id);
    const notif1 = user1.notifications.find(n => n.type === 'priceDrop');
    const notif2 = user2.notifications.find(n => n.type === 'priceDrop');
    expect(notif1).toBeDefined();
    expect(notif2).toBeDefined();
  });
});