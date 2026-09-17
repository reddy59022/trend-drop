jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import { getSellerBadge } from './api';

const api = axios.create.mock.results[0].value;

test('getSellerBadge rejects malformed seller IDs without issuing a request', async () => {
  await expect(getSellerBadge('not-an-object-id')).rejects.toThrow(/invalid seller id/i);
  expect(api.get).not.toHaveBeenCalled();
});
