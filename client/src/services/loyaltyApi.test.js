jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import { getLoyaltyStatus, earnLoyaltyPoints, redeemLoyaltyPoints, getLoyaltyHistory } from './api';

const api = axios.create.mock.results[0].value;

test('loyalty helpers cover every server route with the expected payloads', () => {
  getLoyaltyStatus();
  earnLoyaltyPoints({ purchaseAmount: 25, reason: 'purchase' });
  redeemLoyaltyPoints(100);
  getLoyaltyHistory();

  expect(api.get).toHaveBeenNthCalledWith(1, '/loyalty');
  expect(api.post).toHaveBeenNthCalledWith(1, '/loyalty/earn', { purchaseAmount: 25, reason: 'purchase' });
  expect(api.post).toHaveBeenNthCalledWith(2, '/loyalty/redeem', { amount: 100 });
  expect(api.get).toHaveBeenNthCalledWith(2, '/loyalty/history');
});
