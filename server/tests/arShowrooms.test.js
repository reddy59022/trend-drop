const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const ARShowroom = require('../models/ARShowroom');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user, otherUser;
let userToken;
let testListing;
let testShowroom;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `ar_${Date.now()}_`;
  
  user = await User.create({
    name: 'Showroom Host', email: `${seedBase}host@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Host', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  otherUser = await User.create({
    name: 'Other User', email: `${seedBase}other@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Other', street1: '456 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

  testListing = await Listing.create({
    title: 'AR Showroom Item',
    description: 'For testing AR showrooms',
    price: 100,
    category: 'Home',
    condition: 'New with tags',
    images: ['https://example.com/item.jpg'],
    seller: user._id,
    quantity: 1,
    status: 'active',
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (otherUser) await User.findByIdAndDelete(otherUser._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  if (testShowroom) await ARShowroom.findByIdAndDelete(testShowroom._id);
  await mongoose.connection.close();
});

describe('v48.0 AR Showrooms', () => {
  test('v48.1 - Should list all public showrooms', async () => {
    const res = await request(app).get('/api/ar-showrooms');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.showrooms)).toBe(true);
  });

  test('v48.2 - Should create a showroom', async () => {
    const res = await request(app)
      .post('/api/ar-showrooms')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'My Living Room',
        description: 'Showcasing my favorite furniture pieces',
        roomType: 'living_room',
        dimensions: { width: 5, length: 4, height: 2.5 },
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('My Living Room');
    testShowroom = res.body;
  });

  test('v48.3 - Should get single showroom details', async () => {
    const res = await request(app).get(`/api/ar-showrooms/${testShowroom._id}`);
    expect(res.status).toBe(200);
    expect(res.body.seller).toBeDefined();
    expect(res.body.items).toBeDefined();
  });

  test('v48.4 - Should add item to showroom', async () => {
    const res = await request(app)
      .post(`/api/ar-showrooms/${testShowroom._id}/items`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        listingId: testListing._id,
        position: { x: 1, y: 0, z: 2, rotation: 45 },
      });

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
  });

  test('v48.5 - Should reject adding item for non-owned showroom', async () => {
    const res = await request(app)
      .post(`/api/ar-showrooms/${testShowroom._id}/items`)
      .set('Authorization', `Bearer ${jwt.sign({ id: otherUser._id }, JWT_SECRET, { expiresIn: '30d' })}`)
      .send({ listingId: testListing._id });

    expect(res.status).toBe(403);
  });

  test('v48.6 - Should get seller showrooms', async () => {
    const res = await request(app).get(`/api/ar-showrooms/seller/${user._id}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v48.7 - Should update showroom', async () => {
    const res = await request(app)
      .put(`/api/ar-showrooms/${testShowroom._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ description: 'Updated description' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated description');
  });

  test('v48.8 - Should require authentication for creating showrooms', async () => {
    const res = await request(app)
      .post('/api/ar-showrooms')
      .send({ name: 'Test' });

    expect(res.status).toBe(401);
  });

  test('v48.9 - Should return 404 for non-existent showroom', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/api/ar-showrooms/${fakeId}`);
    expect(res.status).toBe(404);
  });

  test('v48.10 - Should delete showroom', async () => {
    const res = await request(app)
      .delete(`/api/ar-showrooms/${testShowroom._id}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    testShowroom = null; // Prevent double cleanup
  });

  test('v48.11 - Should like a showroom', async () => {
    const showroom = await ARShowroom.create({
      seller: user._id,
      name: 'Test Showroom',
      description: 'Test',
      roomType: 'bedroom',
    });

    const res = await request(app)
      .post(`/api/ar-showrooms/${showroom._id}/like`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.likeCount).toBe(1);

    await ARShowroom.findByIdAndDelete(showroom._id);
  });
});