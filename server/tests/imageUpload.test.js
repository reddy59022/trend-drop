const request = require('supertest');
const app = require('../server');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Helper to create a temporary file of a given size (in bytes)
function createTempFile(name, size) {
  const filePath = path.join(__dirname, name);
  const buffer = Buffer.alloc(size, 0);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// Create a dummy user in the test DB and obtain a valid JWT for auth
async function getAuthToken() {
  const mongoose = require('mongoose');
  const User = require('../models/User');
  // Ensure the test DB is connected (jest will have started the server which connects)
  // Create a user with a known ObjectId
  const dummyId = new mongoose.Types.ObjectId();
  await User.create({
    _id: dummyId,
    name: 'TestUser',
    email: 'testuser@example.com',
    password: 'hashed', // password not validated here
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    shippingAddress: { fullName: 'Test', street1: '1 St', city: 'City', state: 'CA', postalCode: '12345', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';
  return jwt.sign({ id: dummyId }, secret, { expiresIn: '1h' });
}

describe('Image Upload Constraints', () => {
  let token;
  beforeAll(async () => {
    token = await getAuthToken();
  });

  test('Reject more than 10 images', async () => {
    // Create 11 tiny image files (1KB each)
    const files = [];
    for (let i = 0; i < 11; i++) {
      files.push(createTempFile(`tiny${i}.jpg`, 1024));
    }
    const req = request(app).post('/api/listings').set('Authorization', `Bearer ${token}`);
    // Required fields for a listing
    req.field('title', 'Test Listing');
    req.field('description', 'desc');
    req.field('price', '100');
    req.field('category', 'Men');
    req.field('condition', 'Good');
    // Attach all 11 images
    files.forEach(f => req.attach('images', f));
    const res = await req;
    // Multer is configured to allow max 10 files, so expect 400 or 413
    expect([400, 413]).toContain(res.status);
    // Cleanup temporary files
    files.forEach(f => fs.unlinkSync(f));
  });

  test('Reject file larger than 2MB', async () => {
    const largeFile = createTempFile('large.jpg', 2 * 1024 * 1024 + 500 * 1024); // 2.5MB
    const req = request(app).post('/api/listings').set('Authorization', `Bearer ${token}`);
    req.field('title', 'Big File Listing');
    req.field('description', 'desc');
    req.field('price', '150');
    req.field('category', 'Women');
    req.field('condition', 'New');
    req.attach('images', largeFile);
    const res = await req;
    // Multer should reject oversized payload
    expect([400, 413]).toContain(res.status);
    fs.unlinkSync(largeFile);
  });
});
