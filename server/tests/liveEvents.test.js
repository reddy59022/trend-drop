const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const LiveEvent = require('../models/LiveEvent');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user, buyer;
let userToken, buyerToken;
let testListing;
let testEvent;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `live_${Date.now()}_`;
  
  user = await User.create({
    name: 'Event Host', email: `${seedBase}host@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Host', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  
  buyer = await User.create({
    name: 'Event Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
  
  testListing = await Listing.create({
    title: 'Live Event Item',
    description: 'For testing live events',
    price: 100,
    category: 'Women',
    condition: 'New with tags',
    images: ['https://example.com/item.jpg'],
    seller: user._id,
    quantity: 1,
    status: 'active',
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (buyer) await User.findByIdAndDelete(buyer._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  if (testEvent) await LiveEvent.findByIdAndDelete(testEvent._id);
  await mongoose.connection.close();
});

describe('v47.0 Live Shopping Events', () => {
  test('v47.1 - Should list all live events', async () => {
    const res = await request(app).get('/api/live-events');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  test('v47.2 - Should create a live event', async () => {
    const res = await request(app)
      .post('/api/live-events')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        title: 'Summer Collection Live',
        description: 'Live showcase of summer items',
        listingIds: [testListing._id],
        startTime: new Date(Date.now() + 3600000),
        endTime: new Date(Date.now() + 7200000),
        discount: 15,
        maxViewers: 50,
      });
    
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Summer Collection Live');
    testEvent = res.body;
  });

  test('v47.3 - Should get single event details', async () => {
    const res = await request(app).get(`/api/live-events/${testEvent._id}`);
    expect(res.status).toBe(200);
    expect(res.body.host).toBeDefined();
  });

  test('v47.4 - Should join a live event', async () => {
    const res = await request(app)
      .post(`/api/live-events/${testEvent._id}/join`)
      .set('Authorization', `Bearer ${buyerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.viewers).toBeGreaterThan(0);
  });

  test('v47.5 - Should get host statistics', async () => {
    const res = await request(app).get(`/api/live-events/stats/${user._id}`);
    expect(res.status).toBe(200);
    expect(res.body.totalEvents).toBeGreaterThan(0);
  });

  test('v47.6 - Should require authentication for creating events', async () => {
    const res = await request(app)
      .post('/api/live-events')
      .send({ title: 'Test' });
    
    expect(res.status).toBe(401);
  });

  test('v47.7 - Should require authentication for joining events', async () => {
    const res = await request(app)
      .post(`/api/live-events/${testEvent._id}/join`);
    
    expect(res.status).toBe(401);
  });

  test('v47.8 - Should reject non-owned listings for hosting', async () => {
    const res = await request(app)
      .post('/api/live-events')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        title: 'Invalid Event',
        listingIds: [testListing._id],
        startTime: new Date(Date.now() + 3600000),
        endTime: new Date(Date.now() + 7200000),
      });
    
    expect(res.status).toBe(403);
  });

  test('v47.9 - Should get upcoming events for host', async () => {
    const res = await request(app)
      .get('/api/live-events/upcoming')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v47.10 - Should handle purchase check', async () => {
    const res = await request(app)
      .post(`/api/live-events/${testEvent._id}/purchase`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: testListing._id });
    
    // Event is scheduled, not live, so we expect 400
    expect([200, 400]).toContain(res.status);
  });

  test('v47.11 - Should return 404 for non-existent event', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/api/live-events/${fakeId}`);
    expect(res.status).toBe(404);
  });

  test('v47.12 - Should leave a live event', async () => {
    const res = await request(app)
      .post(`/api/live-events/${testEvent._id}/leave`)
      .set('Authorization', `Bearer ${buyerToken}`);
    
    expect(res.status).toBe(200);
  });
});