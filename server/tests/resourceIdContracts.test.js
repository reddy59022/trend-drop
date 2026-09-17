const request = require('supertest');
const app = require('../server');

describe('malformed resource ID contracts', () => {
  const cases = [
    ['GET', '/api/ratings/seller/not-an-object-id'],
    ['GET', '/api/ratings/listing/not-an-object-id'],
    ['GET', '/api/users/not-an-object-id/notifications'],
    ['PUT', '/api/users/not-an-object-id/notifications/read'],
    ['GET', '/api/messages/conversation/not-an-object-id'],
    ['POST', '/api/messages/not-an-object-id'],
    ['PUT', '/api/messages/read/not-an-object-id'],
    ['DELETE', '/api/wishlist/not-an-object-id'],
    ['GET', '/api/wishlist/check/not-an-object-id'],
    ['PUT', '/api/admin/reports/not-an-object-id/status'],
    ['GET', '/api/pricehistory/not-an-object-id'],
    ['POST', '/api/payouts/process/not-an-object-id'],
    ['POST', '/api/listings/not-an-object-id/boost'],
    ['POST', '/api/listings/not-an-object-id/deactivate-boost'],
    ['GET', '/api/saved-searches/not-an-object-id/results'],
    ['PUT', '/api/saved-searches/not-an-object-id'],
    ['DELETE', '/api/saved-searches/not-an-object-id'],
    ['POST', '/api/offer-sharing/share/not-an-object-id'],
    ['POST', '/api/shipping-insurance/not-an-object-id/claim'],
  ];

  test.each(cases)('%s %s returns a client error, never a CastError 500', async (method, path) => {
    const response = await request(app)[method.toLowerCase()](path);
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/invalid/i);
  });
});
