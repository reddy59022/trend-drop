const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const LegalAcceptance = require('../models/LegalAcceptance');
const { CURRENT_VERSIONS } = require('../config/legal');

const email = `legal_${Date.now()}@example.com`;
const consent = {
  termsVersion: CURRENT_VERSIONS.terms,
  privacyVersion: CURRENT_VERSIONS.privacy,
  termsAccepted: true,
  privacyAccepted: true,
  ageConfirmed: true,
};

beforeAll(async () => { if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI); });
afterAll(async () => { await User.deleteMany({ email }); });

describe('legal release contract', () => {
  test('exposes versioned public legal documents without authentication', async () => {
    const res = await request(app).get('/api/legal/documents?country=US');
    expect(res.status).toBe(200);
    expect(res.body.versions.terms).toBe(CURRENT_VERSIONS.terms);
    expect(res.body.documents.map((doc) => doc.type)).toEqual(expect.arrayContaining(['terms', 'privacy', 'buyer', 'seller', 'prohibited']));
    expect(res.body.countryPolicy.status).toBeDefined();
  });

  test('rejects registration without current terms, privacy, and age confirmation', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'No Consent', email: `missing_${email}`, password: 'StrongPass123!', country: 'US' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LEGAL_CONSENT_REQUIRED');
    expect(res.body.required.termsVersion).toBe(CURRENT_VERSIONS.terms);
  });

  test('records consent at registration and carries it through verification', async () => {
    const pending = await request(app).post('/api/auth/register').send({ name: 'Consent User', email, password: 'StrongPass123!', country: 'US', ...consent });
    expect(pending.status).toBe(201);
    const PendingUser = require('../models/PendingUser');
    const row = await PendingUser.findById(pending.body.userId);
    const verified = await request(app).post('/api/auth/verify-email').send({ token: row.verificationToken });
    expect(verified.status).toBe(200);
    const user = await User.findOne({ email });
    expect(user.legalConsent.termsVersion).toBe(CURRENT_VERSIONS.terms);
    expect(await LegalAcceptance.exists({ user: user._id, purpose: 'account' })).toBeTruthy();
  });
});
