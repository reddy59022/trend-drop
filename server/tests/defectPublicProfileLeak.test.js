/**
 * Red test proving a privacy defect in the public user profile endpoint.
 *
 * `GET /api/users/:id` is unauthenticated (anyone can call it for any user id)
 * but returns the ENTIRE user document minus the password hash. That document
 * carries account-private data:
 *
 *   - email, phone                     (contact details)
 *   - shippingAddress                  (home address)
 *   - balance                          (available/pending earnings)
 *   - payoutMethod, store              (payout/bank details)
 *   - verificationToken                (an email-verification credential!)
 *   - legalConsent, onboarding         (tax/legal data)
 *   - role, authProvider, notifications, social ids, ...
 *
 * Any visitor can therefore enumerate user ids and harvest addresses, contact
 * details, balances and verification tokens. The endpoint's contract is a
 * PUBLIC profile: only the fields the client renders for another user
 * (name, avatar, bio, location, closetName, socialLinks, seller stats,
 * followers/following) may be exposed. The owner's own account data is already
 * served by the authenticated `GET /api/users/me`.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');
const Listing = require('../models/Listing');

let seller;

const PRIVATE_FIELDS = [
  'email',
  'phone',
  'phoneCode',
  'password',
  'shippingAddress',
  'balance',
  'payoutMethod',
  'store',
  'verificationToken',
  'verificationTokenExpires',
  'legalConsent',
  'onboarding',
  'role',
  'authProvider',
  'emailVerified',
  'notifications',
  'googleId',
  'appleId',
  'facebookId',
];

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  seller = await User.create({
    name: 'Leak Victim',
    email: `leak_victim_${seed}@example.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    phone: '+15551234567',
    shippingAddress: { fullName: 'Victim', street1: '1 Secret Lane', city: 'Hidden', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 4321.09, pending: 12.5, totalEarned: 5000, totalPaidOut: 0, currency: 'USD' },
    payoutMethod: { type: 'bank', accountLast4: '4242' },
    store: { name: 'Secret Store', taxId: 'SECRET-TAX-ID' },
    verificationToken: 'super-secret-verification-token',
    verificationTokenExpires: new Date(Date.now() + 86400000),
    legalConsent: { termsVersion: '1.0.0', privacyVersion: '1.0.0', acceptedAt: new Date() },
    bio: 'Public bio',
    location: 'Los Angeles, CA',
    closetName: 'Public Closet',
  });
});

describe('DEFECT: public profile must not expose private account data', () => {
  test('PP.1 unauthenticated GET /api/users/:id omits every private field', async () => {
    const res = await api.get(`/api/users/${seller._id}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();

    for (const field of PRIVATE_FIELDS) {
      expect(res.body.user[field]).toBeUndefined();
    }
  });

  test('PP.2 the raw response body never contains the private values', async () => {
    const res = await api.get(`/api/users/${seller._id}`);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(seller.email);
    expect(raw).not.toContain('+15551234567');
    expect(raw).not.toContain('1 Secret Lane');
    expect(raw).not.toContain('super-secret-verification-token');
    expect(raw).not.toContain('SECRET-TAX-ID');
  });

  test('PP.3 public profile fields are still returned', async () => {
    const res = await api.get(`/api/users/${seller._id}`);
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Leak Victim');
    expect(res.body.user.bio).toBe('Public bio');
    expect(res.body.user.location).toBe('Los Angeles, CA');
    expect(res.body.user.closetName).toBe('Public Closet');
    expect(Array.isArray(res.body.user.followers)).toBe(true);
    expect(Array.isArray(res.body.user.following)).toBe(true);
    expect(typeof res.body.listingsCount).toBe('number');
  });

  test('PP.4 REGRESSION GUARD: the owner still gets their own account from /api/users/me', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: seller._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '1h' });
    const res = await api.get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(seller.email);
    expect(res.body.password).toBeUndefined();
  });
});

describe('DEFECT: a public profile must not list unpublished (draft/paused) items', () => {
  let live;
  let draft;

  beforeAll(async () => {
    live = await Listing.create({
      seller: seller._id,
      title: 'Profile Live Item',
      description: 'Published on the public profile',
      price: 40,
      category: 'Men',
      condition: 'Good',
      quantity: 1,
      available: true,
      sold: false,
      status: 'active',
      images: [],
    });
    draft = await Listing.create({
      seller: seller._id,
      title: 'Profile Draft Item',
      description: 'Never published — must stay hidden',
      price: 40,
      category: 'Men',
      condition: 'Good',
      quantity: 1,
      available: false,
      sold: false,
      status: 'draft',
      images: [],
    });
  });

  test('PP.5 an anonymous visitor sees only published listings on the seller catalog', async () => {
    const res = await api.get(`/api/listings/user/${seller._id}`);
    expect(res.status).toBe(200);
    const ids = res.body.listings.map((l) => String(l._id));
    expect(ids).toContain(String(live._id));
    expect(ids).not.toContain(String(draft._id));
    expect(res.body.total).toBe(1);
  });

  test('PP.6 REGRESSION GUARD: the seller still sees their own drafts for management', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: seller._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: '1h' });
    const res = await api
      .get(`/api/listings/user/${seller._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.listings.map((l) => String(l._id));
    expect(ids).toContain(String(draft._id));
  });
});
