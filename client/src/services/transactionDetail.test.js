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
import { getTransaction } from './api';

const api = axios.create.mock.results[0].value;

test('getTransaction rejects malformed IDs without a network request', async () => {
  await expect(getTransaction('not-a-mongo-id')).rejects.toThrow(/invalid transaction id/i);
  expect(api.get).not.toHaveBeenCalled();
});

test('getTransaction requests valid transaction IDs', () => {
  getTransaction('507f1f77bcf86cd799439011');
  expect(api.get).toHaveBeenCalledWith('/transactions/507f1f77bcf86cd799439011');
});
