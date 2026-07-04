const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user, buyer;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `share_${Date.now()}_`;
  
  user = await User.create({
    name: 'Share Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  
  buyer = await User.create({
    name: 'Share Buyer', email: `${seedBase}buyer@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Buyer', street1: '456 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  
   // Create listing with a liker
   testListing = await Listing.create({
     title: 'Bundle Item',
     description: 'For testing bundle offers',
     price: 50,
     category: 'Women',
     condition: 'New with tags',
     images: ['https://example.com/item.jpg'],
     seller: user._id,
     quantity: 1,
     status: 'active',
     likes: [buyer._id], // Add buyer as liker
   });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (buyer) await User.findByIdAndDelete(buyer._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  await Offer.deleteMany({});
  await mongoose.connection.close();
});

describe('v45.0 Offer & Bundle Sharing', () => {
  test('v45.1 - Should get sharing stats', async () => {
    const res = await request(app)
      .get('/api/offer-sharing/stats')
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.totalOffers).toBeDefined();
  });

  test('v45.2 - Should share offer with likers', async () => {
    const res = await request(app)
      .post(`/api/offer-sharing/to-likers/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ discountValue: 15 });
    
    expect(res.status).toBe(200);
    expect(res.body.offersCount).toBeGreaterThan(0);
  });

  test('v45.3 - Should require authentication for sharing', async () => {
    const res = await request(app)
      .post(`/api/offer-sharing/to-likers/${testListing._id}`);
    
    expect(res.status).toBe(401);
  });

  test('v45.4 - Should reject bundle with less than 2 items', async () => {
    const res = await request(app)
      .post('/api/offer-sharing/bundle')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ listingIds: [testListing._id] });
    
    expect(res.status).toBe(400);
  });

  test('v45.5 - Should share specific offer with friends', async () => {
    // First create an offer
    const offer = await Offer.create({
      listing: testListing._id,
      seller: user._id,
      buyer: buyer._id,
      amount: 45,
      originalPrice: 50,
      status: 'pending',
    });
    
    const res = await request(app)
      .post(`/api/offer-sharing/share/${offer._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ friendIds: [buyer._id] });
    
    expect(res.status).toBe(200);
    expect(res.body.offers).toBeDefined();
  });

  test('v45.6 - Should reject sharing non-existent offer', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`/api/offer-sharing/share/${fakeId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ friendIds: [buyer._id] });
    
    expect(res.status).toBe(404);
  });

  test('v45.7 - Should reject non-owner sharing offers', async () => {
    const res = await request(app)
      .post(`/api/offer-sharing/to-likers/${testListing._id}`)
      .set('Authorization', `Bearer ${jwt.sign({ id: buyer._id }, JWT_SECRET, { expiresIn: '30d' })}`);
    
    expect(res.status).toBe(403);
  });
});