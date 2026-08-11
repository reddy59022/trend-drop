// pushEvents.test.js — TD-2.3 Push notification event hooks (route layer).
//
// Verifies that real events trigger pushes through the real pushService:
//   * new conversation / reply in /api/messages → push to the other party
//   * offer accepted in /api/offers/:id/accept → push to the buyer
// Transports are mocked (server/jest.setup.js); the service, preference
// gating, and route wiring run for real.

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');
const Message = require('../models/Message');
const PushDevice = require('../models/PushDevice');
const MobilePreferences = require('../models/MobilePreferences');
const jwt = require('jsonwebtoken');
const transports = require('../services/pushTransports');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const seedBase = `pushevt_${Date.now()}_`;

let buyer, seller, buyerToken, sellerToken, listing;

const testUserIds = [];
const testListingIds = [];

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  seller = await User.create({
    name: 'PushSeller',
    email: `${seedBase}seller@test.com`,
    password: 'password123',
    emailVerified: true,
    country: 'US',
    currency: 'USD',
  });
  testUserIds.push(seller._id);

  buyer = await User.create({
    name: 'PushBuyer',
    email: `${seedBase}buyer@test.com`,
    password: 'password123',
    emailVerified: true,
    country: 'US',
    currency: 'USD',
  });
  testUserIds.push(buyer._id);

  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });

  listing = await Listing.create({
    seller: seller._id,
    title: 'Push Test Item',
    description: 'Test listing for push events',
    category: 'Electronics',
    condition: 'New with tags',
    price: 100,
    currency: 'USD',
    available: true,
    quantity: 5,
    shipsFrom: 'US',
    weight: 1,
  });
  testListingIds.push(listing._id);

  // Buyer has one Android device registered for push.
  await PushDevice.create({ userId: buyer._id, token: 'evt-buyer-android', platform: 'Android' });
  await PushDevice.create({ userId: seller._id, token: 'evt-seller-ios', platform: 'iOS' });
});

beforeEach(async () => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await Offer.deleteMany({ $or: [{ listing: { $in: testListingIds } }, { buyer: { $in: testUserIds } }, { seller: { $in: testUserIds } }] });
  await Message.deleteMany({ participants: { $in: testUserIds } });
  await PushDevice.deleteMany({ userId: { $in: testUserIds } });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
});

describe('TD-2.3 push event hooks', () => {
  test('PE.1 - Starting a conversation pushes the seller (category messages)', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, sellerId: seller._id, text: 'Is this still available?' });

    expect(res.status).toBe(201);

    // Buyer (sender) has an Android device but the RECIPIENT is the seller,
    // so the seller's iOS device gets the APNs push.
    expect(transports.sendApns).toHaveBeenCalledTimes(1);
    expect(transports.sendFcm).not.toHaveBeenCalled();

    const [token, payload] = transports.sendApns.mock.calls[0];
    expect(token).toBe('evt-seller-ios');
    expect(payload.title).toContain('PushBuyer');
    expect(payload.body).toBe('Is this still available?');
    expect(payload.data.category).toBe('messages');
    expect(payload.data.type).toBe('message');
  });

  test('PE.2 - Replying to a conversation pushes the other participant', async () => {
    const start = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, sellerId: seller._id, text: 'First message' });
    const conversationId = start.body._id;

    const res = await request(app)
      .post(`/api/messages/${conversationId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ text: 'Yes, it is!' });

    expect(res.status).toBe(200);

    // Recipient is the buyer → Android device → FCM.
    expect(transports.sendFcm).toHaveBeenCalledTimes(1);
    const [token, payload] = transports.sendFcm.mock.calls[0];
    expect(token).toBe('evt-buyer-android');
    expect(payload.title).toContain('PushSeller');
    expect(payload.body).toBe('Yes, it is!');
    expect(payload.data.category).toBe('messages');
    expect(payload.data.conversationId).toBe(conversationId);
  });

  test('PE.3 - No push when recipient has no devices', async () => {
    // A third user with no PushDevice record — becomes the RECIPIENT.
    const stranger = await User.create({
      name: 'PushStranger',
      email: `${seedBase}stranger@test.com`,
      password: 'password123',
      emailVerified: true,
      country: 'US',
      currency: 'USD',
    });
    testUserIds.push(stranger._id);

    // Buyer messages the stranger (recipient has no registered devices).
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, sellerId: stranger._id, text: 'Hi stranger' });

    expect(res.status).toBe(201);
    expect(transports.sendApns).not.toHaveBeenCalled();
    expect(transports.sendFcm).not.toHaveBeenCalled();
  });

  test('PE.4 - Accepting an offer pushes the buyer (category offers)', async () => {
    const offerRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 80 });
    expect(offerRes.status).toBe(201);
    const offerId = offerRes.body._id;

    const res = await request(app)
      .patch(`/api/offers/${offerId}/accept`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.offer.status).toBe('accepted');

    // Buyer (recipient) has an Android device → FCM.
    expect(transports.sendFcm).toHaveBeenCalledTimes(1);
    const [token, payload] = transports.sendFcm.mock.calls[0];
    expect(token).toBe('evt-buyer-android');
    expect(payload.title).toContain('accepted');
    expect(payload.body).toContain('80');
    expect(payload.data.category).toBe('offers');
    expect(payload.data.type).toBe('offer');
    expect(payload.data.offerId).toBe(offerId);
    expect(payload.data.listingId).toBe(listing._id.toString());
  });

  test('PE.5 - Offer push respects the buyer pushNotifications.offers=false toggle', async () => {
    await MobilePreferences.findOneAndUpdate(
      { userId: buyer._id },
      { pushNotifications: { enabled: true, offers: false, messages: true } },
      { upsert: true }
    );

    const offerRes = await request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listing._id, amount: 70 });
    const offerId = offerRes.body._id;

    const res = await request(app)
      .patch(`/api/offers/${offerId}/accept`)
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(res.status).toBe(200); // Request still succeeds…
    expect(transports.sendFcm).not.toHaveBeenCalled(); // …but no push fired.

    await MobilePreferences.findOneAndUpdate(
      { userId: buyer._id },
      { pushNotifications: { enabled: true, offers: true, messages: true } },
      { upsert: true }
    );
  });
});
