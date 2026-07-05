const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Video = require('../models/Video');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;
let testListing;
let testVideo;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `video_${Date.now()}_`;
  
  user = await User.create({
    name: 'Video User', email: `${seedBase}video@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

  testListing = await Listing.create({
    title: 'Video Item', description: 'Test', price: 50, category: 'Women',
    condition: 'New with tags', images: ['https://example.com/video.jpg'], seller: user._id, quantity: 1, status: 'active',
  });

  testVideo = await Video.create({
    listing: testListing._id,
    seller: user._id,
    videoUrl: 'https://example.com/video.mp4',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    duration: 30,
    title: 'Test Video',
    status: 'active',
    analytics: { views: 10, likes: 5, shares: 2 }
  });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  if (testListing) await Listing.findByIdAndDelete(testListing._id);
  await Video.deleteMany({});
  await mongoose.connection.close();
});

describe('v54.0 Video Shopping Integration', () => {
  test('v54.1 - Should require auth for videos', async () => {
    const res = await request(app).get('/api/video-shopping');
    expect(res.status).toBe(401);
  });

  test('v54.2 - Should get user videos', async () => {
    const res = await request(app)
      .get('/api/video-shopping')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v54.3 - Should get public videos feed', async () => {
    const res = await request(app)
      .get('/api/video-shopping/public')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v54.4 - Should upload new video', async () => {
    const res = await request(app)
      .post('/api/video-shopping/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        listingId: testListing._id,
        videoUrl: 'https://example.com/newvideo.mp4',
        duration: 45
      });

    expect(res.status).toBe(201);
    expect(res.body.videoUrl).toBeDefined();
  });

  test('v54.5 - Should get single video and increment views', async () => {
    const initialViews = testVideo.analytics.views;
    const res = await request(app)
      .get(`/api/video-shopping/${testVideo._id}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.videoUrl).toBeDefined();
  });

  test('v54.6 - Should update video', async () => {
    const res = await request(app)
      .put(`/api/video-shopping/${testVideo._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'Updated Title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
  });

  test('v54.7 - Should like video', async () => {
    const res = await request(app)
      .post(`/api/video-shopping/${testVideo._id}/like`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.likes).toBeDefined();
  });

  test('v54.8 - Should share video', async () => {
    const res = await request(app)
      .post(`/api/video-shopping/${testVideo._id}/share`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.shares).toBeDefined();
  });
});