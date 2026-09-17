const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const EnterpriseWebhook = require('../models/EnterpriseWebhook');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let userToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  
  const seedBase = `enterprise_${Date.now()}_`;
  
  user = await User.create({
    name: 'Enterprise User', email: `${seedBase}enterprise@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    shippingAddress: { fullName: 'User', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
  });

  userToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(async () => {
  if (user) await User.findByIdAndDelete(user._id);
  await mongoose.connection.close();
});

describe('v60.0 Enterprise API Suite', () => {
  test('v60.1 - Should require auth for enterprise API', async () => {
    const res = await request(app).get('/api/enterprise/listings');
    expect(res.status).toBe(401);
  });

  test('v60.2 - Should get listings via API', async () => {
    const res = await request(app)
      .get('/api/enterprise/listings')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v60.3 - Should get orders via API', async () => {
    const res = await request(app)
      .get('/api/enterprise/orders')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('v60.4 - Should register webhook', async () => {
    const res = await request(app)
      .post('/api/enterprise/webhook')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: 'https://your-app.com/webhook', events: ['order.created'] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('registered');
  });

  test('v60.5 - Should export the authenticated seller data, not a placeholder URL', async () => {
    await Listing.create({
      seller: user._id,
      title: 'Enterprise export item',
      description: 'Exportable item',
      price: 25,
      category: 'Women',
      condition: 'Good',
    });

    const res = await request(app)
      .post('/api/enterprise/export')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ type: 'listings' });
    expect(res.status).toBe(200);
    expect(res.body.recordCount).toBe(1);
    expect(res.body.records[0].title).toBe('Enterprise export item');
    expect(res.body.downloadUrl).toBeUndefined();
  });

  test('v60.6 - Rejects invalid export types and date ranges', async () => {
    const invalidType = await request(app)
      .post('/api/enterprise/export')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ type: 'users' });
    expect(invalidType.status).toBe(400);

    const invalidDates = await request(app)
      .post('/api/enterprise/export')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ type: 'listings', startDate: 'not-a-date', endDate: '2026-01-01' });
    expect(invalidDates.status).toBe(400);
  });

  test('v60.7 - Persists only validated HTTPS webhook registrations', async () => {
    const invalid = await request(app)
      .post('/api/enterprise/webhook')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: 'http://localhost/hook', events: ['*'] });
    expect(invalid.status).toBe(400);

    const valid = await request(app)
      .post('/api/enterprise/webhook')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: 'https://partner.example.com/hook', events: ['order.created'] });
    expect(valid.status).toBe(200);

    const stored = await EnterpriseWebhook.findOne({ user: user._id }).lean();
    expect(stored.url).toBe('https://partner.example.com/hook');
    expect(stored.events).toEqual(['order.created']);
  });
});