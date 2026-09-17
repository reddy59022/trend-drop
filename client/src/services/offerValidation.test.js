jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() }, },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import { claimBulkOffer, shareOfferWithFriends } from './api';

const api = axios.create.mock.results[0].value;

describe('offer identifier validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects malformed bulk-offer IDs without making a request', async () => {
    await expect(claimBulkOffer('not-an-object-id')).rejects.toThrow('Invalid offer ID');
    expect(api.post).not.toHaveBeenCalled();
  });

  test('rejects malformed shared-offer IDs without making a request', async () => {
    await expect(shareOfferWithFriends('bad-id', { recipientIds: [] }))
      .rejects.toThrow('Invalid offer ID');
    expect(api.post).not.toHaveBeenCalled();
  });

  test('preserves valid offer requests', async () => {
    const offerId = '507f1f77bcf86cd799439011';

    await claimBulkOffer(offerId);
    expect(api.post).toHaveBeenCalledWith(`/offers/to-likers/${offerId}/claim`);
  });
});
