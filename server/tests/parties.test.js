const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Party = require('../models/Party');
const Listing = require('../models/Listing');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let seller, buyer;
let sellerToken, buyerToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `party_${Date.now()}_`;
  
  seller = await User.create({
    name: 'Party Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });
  
  buyer = await User.create({
    name: 'Party Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  buyerToken = jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (seller) await User.findByIdAndDelete(seller._id);
  if (buyer) await User.findByIdAndDelete(buyer._id);
  await Party.deleteMany({ hostId: { $in: [seller._id, buyer._id] } });
  await mongoose.connection.close();
});

describe('v37.0 Social Sharing & Parties', () => {
  test('v37.1 - Should list all active parties', async () => {
    const res = await request(app).get('/api/parties');
    expect(res.status).toBe(200);
    expect(res.body.parties).toBeDefined();
    expect(Array.isArray(res.body.parties)).toBe(true);
  });

  test('v37.2 - Should filter parties by category', async () => {
    const res = await request(app).get('/api/parties?category=Women');
    expect(res.status).toBe(200);
    expect(res.body.parties).toBeDefined();
  });

  test('v37.3 - Should create a party as authenticated user', async () => {
    const res = await request(app)
      .post('/api/parties')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Summer Clearance Sale',
        description: 'Up to 50% off summer items!',
        category: 'Women',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        discountPercent: 15,
      });
    
    expect(res.status).toBe(201);
    expect(res.body.party.title).toBe('Summer Clearance Sale');
    expect(res.body.party.hostId).toBeDefined();
  });

  test('v37.4 - Should get single party details', async () => {
    // First create a party
    const createRes = await request(app)
      .post('/api/parties')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Fall Sale Party',
        category: 'Men',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    
    const partyId = createRes.body.party._id;
    
    const res = await request(app).get(`/api/parties/${partyId}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Fall Sale Party');
  });

  test('v37.5 - Should return 404 for non-existent party', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/api/parties/${fakeId}`);
    expect(res.status).toBe(404);
  });

  test('v37.6 - Should update party (host only)', async () => {
    const createRes = await request(app)
      .post('/api/parties')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Original Title',
        category: 'Women',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    
    const partyId = createRes.body.party._id;
    
    const res = await request(app)
      .put(`/api/parties/${partyId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title: 'Updated Title' });
    
    expect(res.status).toBe(200);
    expect(res.body.party.title).toBe('Updated Title');
  });

  test('v37.7 - Should prevent non-host from updating party', async () => {
    const createRes = await request(app)
      .post('/api/parties')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Host Party',
        category: 'Women',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    
    const partyId = createRes.body.party._id;
    
    const res = await request(app)
      .put(`/api/parties/${partyId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ title: 'Hacked Title' });
    
    expect(res.status).toBe(403);
  });

  test('v37.8 - Should share a party and increment share count', async () => {
    const createRes = await request(app)
      .post('/api/parties')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Shareable Party',
        category: 'Women',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    
    const partyId = createRes.body.party._id;
    
    const res = await request(app)
      .post(`/api/parties/${partyId}/share`)
      .set('Authorization', `Bearer ${buyerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.shareCount).toBeGreaterThan(0);
  });

  test('v37.9 - Should join a party and increment participant count', async () => {
    const createRes = await request(app)
      .post('/api/parties')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Joinable Party',
        category: 'Men',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    
    const partyId = createRes.body.party._id;
    
    const res = await request(app)
      .post(`/api/parties/${partyId}/join`)
      .set('Authorization', `Bearer ${buyerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.participantCount).toBeGreaterThan(0);
  });

  test('v37.10 - Should cancel party (host only)', async () => {
    const createRes = await request(app)
      .post('/api/parties')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Cancellable Party',
        category: 'Women',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    
    const partyId = createRes.body.party._id;
    
    const res = await request(app)
      .delete(`/api/parties/${partyId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Party cancelled');
    
    // Verify status changed
    const party = await Party.findById(partyId);
    expect(party.status).toBe('cancelled');
  });

  test('v37.11 - Should return pagination for parties', async () => {
    const res = await request(app).get('/api/parties?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(10);
  });

  test('v37.12 - Should require auth for party creation', async () => {
    const res = await request(app)
      .post('/api/parties')
      .send({
        title: 'Unauth Party',
        category: 'Women',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    
    expect(res.status).toBe(401);
  });
});