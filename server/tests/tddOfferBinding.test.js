// TDD R30 — offerId binding in POST /api/payments/create-intent.
//
// confirm-batch (the consumer of the authorization) validates that a
// client-supplied offerId belongs to THE LISTING BEING BOUGHT
// (`offer.listing !== listing._id` -> 400) before pricing the line at the
// offer price. create-intent, which decides HOW MUCH MONEY IS AUTHORIZED,
// only checked offer.status === 'accepted' and offer.buyer === me — it never
// checked offer.listing. Consequence: an accepted $10 offer on listing A
// could be presented against listing B ($100) and create-intent would
// authorize ~$10 for it; confirm-batch then rejects the pairing, so the
// buyer's card is left with a hold on an intent that can never complete —
// the same dead-end class of bug fixed for negotiated carts in round 26.
// Contract pinned here: an offerId that does not belong to the item's
// listing must be rejected upfront (400) BEFORE any authorization exists;
// the correct listing/offer pairing must still authorize at the offer price.
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');

const JWT_SECRET = getJwtSecret();
const US = { fullName: 'T', street1: '1 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' };

const makeUser = async (name, email) => {
  const user = await User.create({
    name, email, password: 'password123', country: 'US', currency: 'USD',
    emailVerified: true, authProvider: 'email',
    shippingAddress: { ...US },
  });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
  return { user, token };
};

const makeListing = async (seller, price, title) => Listing.create({
  title,
  description: 'offer binding probe',
  price, currency: 'USD', category: 'Men', size: 'M', condition: 'Good',
  images: ['https://example.com/p.jpg'], seller: seller._id, available: true,
  quantity: 5, shipsFrom: 'US',
});

const acceptOffer = (listing, buyer, seller, price) => Offer.create({
  listing: listing._id,
  buyer: buyer._id,
  seller: seller._id,
  amount: price,
  status: 'accepted',
  acceptedPrice: price,
  acceptedAt: new Date(),
  acceptedUntil: new Date(Date.now() + 24 * 3600 * 1000),
  acceptedBy: 'seller',
  currency: 'USD',
});

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
});

describe('TDD R30 — create-intent offerId must be bound to the item listing', () => {
  test('an accepted offer for listing A cannot price listing B (rejected upfront, no hold minted)', async () => {
    const seller = await makeUser('R30Seller', `r30seller_${Date.now()}@test.com`);
    const buyer = await makeUser('R30Buyer', `r30buyer_${Date.now()}@test.com`);
    const listingA = await makeListing(seller.user, 20, `R30-A_${Date.now()}`);
    const listingB = await makeListing(seller.user, 100, `R30-B_${Date.now()}`);
    const offer = await acceptOffer(listingA, buyer.user, seller.user, 10);

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        items: [{ listingId: listingB._id.toString(), offerId: offer._id.toString() }],
        shippingAddress: US,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  test('the correct listing+offerId pairing still authorizes at the OFFER price', async () => {
    const seller = await makeUser('R30Seller2', `r30seller2_${Date.now()}@test.com`);
    const buyer = await makeUser('R30Buyer2', `r30buyer2_${Date.now()}@test.com`);
    const listingA = await makeListing(seller.user, 20, `R30-A2_${Date.now()}`);
    const offer = await acceptOffer(listingA, buyer.user, seller.user, 10);

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        items: [{ listingId: listingA._id.toString(), offerId: offer._id.toString() }],
        shippingAddress: US,
      });

    expect(res.status).toBe(200);
    expect(typeof res.body.amount).toBe('number');
    // Offer price ($10) + shipping + protection; must be far below the
    // $100 list-price line of a hypothetical mismatched listing.
    expect(res.body.amount).toBeGreaterThan(0);
    expect(res.body.amount).toBeLessThan(30);
  });
});