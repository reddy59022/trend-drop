const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Comment = require('../models/Comment');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user, seller;
let userToken;
let testListing;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `comment_${Date.now()}_`;
  
  user = await User.create({
    name: 'Comment User', email: `${seedBase}user@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  
  seller = await User.create({
    name: 'Comment Seller', email: `${seedBase}seller@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '456 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });
  
  testListing = await Listing.create({
    title: 'Test Dress for Comments',
    description: 'Beautiful dress for testing comments',
    price: 50,
    category: 'Women',
    condition: 'New with tags',
    images: ['https://example.com/dress.jpg'],
    seller: seller._id,
    quantity: 1,
    status: 'active',
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (seller) await User.findByIdAndDelete(seller._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  await Comment.deleteMany({});
  await mongoose.connection.close();
});

describe('v43.0 Community Features', () => {
  test('v43.1 - Should get comments for a listing', async () => {
    const res = await request(app)
      .get(`/api/comments/${testListing._id}`);
    
    expect(res.status).toBe(200);
    expect(res.body.comments).toBeDefined();
    expect(Array.isArray(res.body.comments)).toBe(true);
  });

  test('v43.2 - Should add a comment to a listing', async () => {
    const res = await request(app)
      .post(`/api/comments/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'Great dress! #fashion #style' });
    
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Great dress! #fashion #style');
    expect(res.body.hashtags).toContain('fashion');
    expect(res.body.hashtags).toContain('style');
  });

  test('v43.3 - Should require authentication for adding comment', async () => {
    const res = await request(app)
      .post(`/api/comments/${testListing._id}`)
      .send({ text: 'Anonymous comment' });
    
    expect(res.status).toBe(401);
  });

  test('v43.4 - Should reject empty comment', async () => {
    const res = await request(app)
      .post(`/api/comments/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: '' });
    
    expect(res.status).toBe(400);
  });

  test('v43.5 - Should like a comment', async () => {
    // Create a comment first
    const createRes = await request(app)
      .post(`/api/comments/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'Love this!' });
    
    const commentId = createRes.body._id;
    
    const res = await request(app)
      .put(`/api/comments/${commentId}/like`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.likes).toBeGreaterThan(0);
    expect(res.body.liked).toBe(true);
  });

  test('v43.6 - Should get comments by hashtag', async () => {
    // Create a comment with hashtag
    await request(app)
      .post(`/api/comments/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'Check out #trendalert' });
    
    const res = await request(app)
      .get('/api/comments/hashtag/trendalert');
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.comments)).toBe(true);
  });

  test('v43.7 - Should get trending hashtags', async () => {
    // First create a comment with hashtags
    const createRes = await request(app)
      .post(`/api/comments/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'Love #trending #fashion #style #trending' });
    
    // Verify the comment was created with hashtags
    expect(createRes.status).toBe(200);
    expect(createRes.body.hashtags).toBeDefined();
    
    const res = await request(app)
      .get('/api/comments/trending');
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v43.8 - Should delete own comment', async () => {
    // Create a comment
    const createRes = await request(app)
      .post(`/api/comments/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'Will delete this' });
    
    const commentId = createRes.body._id;
    
    const delRes = await request(app)
      .delete(`/api/comments/${commentId}`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(delRes.status).toBe(200);
    expect(delRes.body.message).toContain('deleted');
  });

  test('v43.9 - Should add reply to comment', async () => {
    // Create parent comment
    const createRes = await request(app)
      .post(`/api/comments/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'Parent comment' });
    
    const parentId = createRes.body._id;
    
    const res = await request(app)
      .post(`/api/comments/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'This is a reply', parentId });
    
    expect(res.status).toBe(200);
    expect(res.body.parentId).toBe(parentId);
  });

  test('v43.10 - Should reject reply to non-existent parent', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`/api/comments/${testListing._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'Reply', parentId: fakeId });
    
    expect(res.status).toBe(404);
  });
});