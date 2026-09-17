const request = require('supertest');
const app = require('../server');

describe('extended malformed resource ID contracts', () => {
  const cases = [
    ['GET', '/api/admin/users/not-an-object-id'],
    ['PUT', '/api/admin/users/not-an-object-id/role'],
    ['POST', '/api/admin/users/not-an-object-id/suspend'],
    ['POST', '/api/admin/users/not-an-object-id/unsuspend'],
    ['DELETE', '/api/admin/listings/not-an-object-id'],
    ['PUT', '/api/admin/reports/not-an-object-id/status'],
    ['POST', '/api/admin/transactions/not-an-object-id/refund'],
    ['PUT', '/api/admin/seller-badges/not-an-object-id/verification'],
    ['PUT', '/api/offers/bundle/not-an-object-id'],
    ['DELETE', '/api/offers/bundle/not-an-object-id'],
    ['GET', '/api/offers/bulk/not-an-object-id'],
    ['POST', '/api/offer-sharing/to-likers/not-an-object-id'],
    ['PUT', '/api/promos/not-an-object-id'],
    ['DELETE', '/api/promos/not-an-object-id'],
    ['POST', '/api/promos/not-an-object-id/use'],
    ['POST', '/api/shipping-insurance/not-an-object-id/claim'],
    ['POST', '/api/shipping-insurance/not-an-object-id/refund'],
    ['GET', '/api/auctions/not-an-object-id'],
    ['POST', '/api/auctions/not-an-object-id/bids'],
    ['POST', '/api/auctions/not-an-object-id/close'],
  ];

  test.each(cases)('%s %s returns 400 before auth or Mongoose casting', async (method, path) => {
    const response = await request(app)[method.toLowerCase()](path);
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/invalid/i);
  });
});
